/**
 * 文献库标签 ↔ 知识图谱节点 双向缓存同步
 *
 * 设计原则：缓存乐观优先，后端异步纠正。
 * 用户在任一侧操作后，另一侧缓存立即更新，后端调用在后台完成。
 * 失败时通过 invalidateQueries 让 refetch 纠正。
 */
import { computed, toValue } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import {
  kgApi,
  libraryApi,
  type GraphNodeRecord,
  type GraphProjectDetail,
} from '../../api'
import type { PdfDocument } from '../../types'
import { STORES, dbPut } from '../../utils/db'
import { broadcastSync } from '../../utils/broadcast'
import {
  useTagProjectQuery,
  useCreateGraphNodeMutation,
  useUpdateGraphNodeMutation,
  useDeleteGraphNodeMutation,
  useLinkPaperMutation,
  useUnlinkPaperMutation,
  getKeys,
  syncKgToIdb,
  invalidateKgQueries,
  patchLinkPaper,
  patchUnlinkPaper,
  patchAddNode,
  patchReplaceNode,
} from './useKgQueries'
import {
  useAddTagMutation,
  useRemoveTagMutation,
  normalizeDocumentsQueryParams,
} from './useLibraryQueries'

// ==================== Sync guard & operation queue ====================

const syncGuard = new Set<string>()

const pendingOps = new Map<string, Promise<void>>()
function chainOp(key: string, fn: () => Promise<void>) {
  const prev = pendingOps.get(key) ?? Promise.resolve()
  const next = prev.then(fn, () => fn())
  pendingOps.set(key, next)
  next.finally(() => { if (pendingOps.get(key) === next) pendingOps.delete(key) })
}

// ==================== Composable ====================

export function useTagKgSync() {
  const queryClient = useQueryClient()
  const tagProjectQuery = useTagProjectQuery()
  const projectId = computed(() => tagProjectQuery.data.value?.id ?? null)

  // 底层 mutations
  const rawAddTag = useAddTagMutation()
  const rawRemoveTag = useRemoveTagMutation()
  const rawCreateNode = useCreateGraphNodeMutation(projectId)
  const rawUpdateNode = useUpdateGraphNodeMutation(projectId)
  const rawDeleteNode = useDeleteGraphNodeMutation(projectId)
  const rawLinkPaper = useLinkPaperMutation(projectId)
  const rawUnlinkPaper = useUnlinkPaperMutation(projectId)

  // ==================== Cache helpers ====================

  function getDocsQueryKey() {
    return ['documents', normalizeDocumentsQueryParams()] as const
  }

  function getDocsCached(): PdfDocument[] {
    return queryClient.getQueryData<PdfDocument[]>([...getDocsQueryKey()]) ?? []
  }

  function findNodeByLabel(label: string) {
    const pid = toValue(projectId)
    if (!pid) return null
    const detail = queryClient.getQueryData<GraphProjectDetail>(['kg', 'project', pid])
    return detail?.nodes.find((n) => n.label === label) ?? null
  }

  // ==================== 统一乐观更新 helpers ====================

  /** 乐观地向文档缓存中添加或移除 tag */
  function optimisticToggleTagOnDoc(pdfId: string, tag: string, action: 'add' | 'remove') {
    queryClient.setQueryData<PdfDocument[]>([...getDocsQueryKey()], (old) => {
      if (!old) return old
      return old.map((doc) => {
        if (doc.id !== pdfId) return doc
        const tags = doc.tags || []
        if (action === 'add' && !tags.includes(tag)) return { ...doc, tags: [...tags, tag] }
        if (action === 'remove' && tags.includes(tag)) return { ...doc, tags: tags.filter((t) => t !== tag) }
        return doc
      })
    })
    const doc = getDocsCached().find((d) => d.id === pdfId)
    if (doc) dbPut(STORES.LIBRARY, doc).catch(console.warn)
  }

  /** 乐观地向 KG 节点的 linked_paper_ids 添加或移除 paperId */
  function optimisticTogglePaperOnNode(nodeId: string, paperId: string, action: 'link' | 'unlink') {
    if (!toValue(projectId)) return
    if (action === 'link') patchLinkPaper(queryClient, projectId, nodeId, paperId)
    else patchUnlinkPaper(queryClient, projectId, nodeId, paperId)
    syncKgToIdb(queryClient, projectId)
  }

  /** 乐观地在 KG 缓存中创建新节点 */
  function optimisticCreateKgNode(label: string): string {
    if (!toValue(projectId)) return ''
    const tempId = patchAddNode(queryClient, projectId, label)
    syncKgToIdb(queryClient, projectId)
    return tempId
  }

  /** 用服务端真实节点替换缓存中的临时节点 */
  function replaceTempNodeId(tempId: string, serverNode: GraphNodeRecord) {
    patchReplaceNode(queryClient, projectId, tempId, serverNode)
    syncKgToIdb(queryClient, projectId)
  }

  // ==================== 通用同步 helpers ====================

  /** Flow 3/4 通用：linkPaper / unlinkPaper 后同步 Library 侧标签 */
  function syncPaperTagToLibrary(
    nodeId: string,
    paperId: string,
    action: 'add' | 'remove',
  ) {
    const node = queryClient.getQueryData<GraphProjectDetail>([...getKeys(projectId).detail])
      ?.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const tag = node.label

    const guardKey = `lib->kg:${paperId}:${tag}`
    if (syncGuard.has(guardKey)) { syncGuard.delete(guardKey); return }

    const doc = getDocsCached().find((d) => d.id === paperId)
    if (action === 'add' && doc?.tags?.includes(tag)) return
    if (action === 'remove' && !doc?.tags?.includes(tag)) return

    syncGuard.add(guardKey)
    optimisticToggleTagOnDoc(paperId, tag, action)
    broadcastSync('RELOAD_LIBRARY')
    const apiCall = action === 'add' ? libraryApi.addTag : libraryApi.removeTag
    apiCall(paperId, tag).catch(() => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    }).finally(() => { syncGuard.delete(guardKey) })
  }

  /** Flow 5/6 通用：批量乐观更新 docs 标签 + 后台逐个同步后端 */
  function batchSyncTagToDocs(
    paperIds: string[],
    tag: string,
    action: 'add' | 'remove',
    opPrefix: string,
  ) {
    if (!paperIds.length) return

    queryClient.setQueryData<PdfDocument[]>([...getDocsQueryKey()], (old) => {
      if (!old) return old
      return old.map((doc) => {
        if (!paperIds.includes(doc.id) || !doc.tags) return doc
        if (action === 'add' && !doc.tags.includes(tag)) return { ...doc, tags: [...doc.tags, tag] }
        if (action === 'remove' && doc.tags.includes(tag)) return { ...doc, tags: doc.tags.filter((t) => t !== tag) }
        return doc
      })
    })
    broadcastSync('RELOAD_LIBRARY')

    const apiCall = action === 'add' ? libraryApi.addTag : libraryApi.removeTag
    for (const paperId of paperIds) {
      chainOp(`${opPrefix}:${paperId}:${tag}`, async () => {
        try {
          await apiCall(paperId, tag)
          const updatedDoc = getDocsCached().find((d) => d.id === paperId)
          if (updatedDoc) dbPut(STORES.LIBRARY, updatedDoc).catch(console.warn)
        } catch {
          queryClient.invalidateQueries({ queryKey: ['documents'] })
        }
      })
    }
  }

  // ==================== Flow 1: addTag → sync to KG ====================

  function addTag(pdfId: string, tag: string) {
    const guardKey = `lib->kg:${pdfId}:${tag}`
    rawAddTag.mutate({ pdfId, tag }, {
      onSuccess: () => {
        if (syncGuard.has(guardKey)) { syncGuard.delete(guardKey); return }
        const pid = toValue(projectId)
        if (!pid) return

        chainOp(`${tag}:${pdfId}`, async () => {
          const existingNode = findNodeByLabel(tag)
          if (existingNode) {
            if (!existingNode.linked_paper_ids.includes(pdfId)) {
              optimisticTogglePaperOnNode(existingNode.id, pdfId, 'link')
              try {
                await kgApi.linkPaperToNode(existingNode.id, pdfId)
              } catch { invalidateKgQueries(queryClient, projectId) }
            }
          } else {
            const tempId = optimisticCreateKgNode(tag)
            try {
              const serverNode = await kgApi.createNode(pid, { label: tag })
              replaceTempNodeId(tempId, serverNode)
              optimisticTogglePaperOnNode(serverNode.id, pdfId, 'link')
              await kgApi.linkPaperToNode(serverNode.id, pdfId)
            } catch { invalidateKgQueries(queryClient, projectId) }
          }
        })
      },
    })
  }

  // ==================== Flow 2: removeTag → sync to KG ====================

  function removeTag(pdfId: string, tag: string) {
    const guardKey = `lib->kg:${pdfId}:${tag}`
    rawRemoveTag.mutate({ pdfId, tag }, {
      onSuccess: () => {
        if (syncGuard.has(guardKey)) { syncGuard.delete(guardKey); return }
        chainOp(`${tag}:${pdfId}`, async () => {
          const node = findNodeByLabel(tag)
          if (node && node.linked_paper_ids.includes(pdfId)) {
            optimisticTogglePaperOnNode(node.id, pdfId, 'unlink')
            try {
              await kgApi.unlinkPaperFromNode(node.id, pdfId)
            } catch { invalidateKgQueries(queryClient, projectId) }
          }
        })
      },
    })
  }

  // ==================== Flow 3: linkPaper → sync to Library ====================

  function linkPaper(nodeId: string, paperId: string) {
    rawLinkPaper.mutate({ nodeId, paperId }, {
      onSuccess: () => syncPaperTagToLibrary(nodeId, paperId, 'add'),
    })
  }

  // ==================== Flow 4: unlinkPaper → sync to Library ====================

  function unlinkPaper(nodeId: string, paperId: string) {
    rawUnlinkPaper.mutate({ nodeId, paperId }, {
      onSuccess: () => syncPaperTagToLibrary(nodeId, paperId, 'remove'),
    })
  }

  // ==================== Flow 5: updateNodeLabel → sync rename to Library ====================

  function updateNodeLabel(nodeId: string, newLabel: string) {
    const detail = queryClient.getQueryData<GraphProjectDetail>([...getKeys(projectId).detail])
    const oldLabel = detail?.nodes.find((n) => n.id === nodeId)?.label ?? null

    rawUpdateNode.mutate({ nodeId, payload: { label: newLabel } }, {
      onSuccess: () => {
        if (!oldLabel || oldLabel === newLabel) return

        const affectedIds = getDocsCached()
          .filter((d) => d.tags?.includes(oldLabel))
          .map((d) => d.id)

        // 先移除旧标签，再添加新标签
        batchSyncTagToDocs(affectedIds, oldLabel, 'remove', 'rename-rm')
        batchSyncTagToDocs(affectedIds, newLabel, 'add', 'rename-add')
      },
    })
  }

  // ==================== Flow 6: deleteNode → sync to Library ====================

  function deleteNode(nodeId: string) {
    const detail = queryClient.getQueryData<GraphProjectDetail>([...getKeys(projectId).detail])
    const nodeToDelete = detail?.nodes.find((n) => n.id === nodeId)
    const label = nodeToDelete?.label ?? null
    const linkedPaperIds = nodeToDelete?.linked_paper_ids ?? []

    rawDeleteNode.mutate(nodeId, {
      onSuccess: () => {
        if (!label) return
        batchSyncTagToDocs(linkedPaperIds, label, 'remove', 'delete')
      },
    })
  }

  return {
    addTag,
    removeTag,
    linkPaper,
    unlinkPaper,
    updateNodeLabel,
    deleteNode,
    // 透传底层 mutation（供组件访问 isPending 等状态）
    addTagMutation: rawAddTag,
    removeTagMutation: rawRemoveTag,
    createNodeMutation: rawCreateNode,
    updateNodeMutation: rawUpdateNode,
    deleteNodeMutation: rawDeleteNode,
    linkPaperMutation: rawLinkPaper,
    unlinkPaperMutation: rawUnlinkPaper,
    projectId,
  }
}
