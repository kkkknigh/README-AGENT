import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { kgApi, type GraphEdgeRecord, type GraphNodeRecord, type GraphProjectDetail, type KgTreeNode, type KgTreeResponse, type RecomposePayload } from '../../api'
import { STORES, dbPut, dbGet } from '../../utils/db'

const DEFAULT_TAG_PROJECT_NAME = '__tags__'
const DEFAULT_TAG_PROJECT_DESCRIPTION = '系统标签图谱'

// ==================== Tree helpers (乐观更新用) ====================

export function findNodeInTree(nodes: KgTreeNode[], nodeId: string): KgTreeNode | null {
  for (const n of nodes) {
    if (n.id === nodeId) return n
    if (n.children?.length) {
      const found = findNodeInTree(n.children, nodeId)
      if (found) return found
    }
  }
  return null
}

export function removeNodeFromTree(nodes: KgTreeNode[], nodeId: string): KgTreeNode | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.id === nodeId) return nodes.splice(i, 1)[0] ?? null
    if (node.children?.length) {
      const found = removeNodeFromTree(node.children, nodeId)
      if (found) return found
    }
  }
  return null
}

export function makeTreeNode(label: string, id?: string, parentId?: string | null): KgTreeNode {
  return {
    id: id ?? crypto.randomUUID(),
    label,
    description: null,
    properties: null,
    is_root: !parentId,
    linked_paper_count: 0,
    linked_note_count: 0,
    children: [],
  }
}

type Snapshot = {
  prevDetail: GraphProjectDetail | undefined
  prevTree: KgTreeResponse | undefined
}

export function getKeys(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const pid = toValue(projectId)
  return {
    detail: ['kg', 'project', pid] as const,
    tree: ['kg', 'tree', pid] as const,
  }
}

async function cancelAndSnapshot(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: MaybeRefOrGetter<string | null | undefined>,
): Promise<Snapshot> {
  const keys = getKeys(projectId)
  await queryClient.cancelQueries({ queryKey: [...keys.detail] })
  await queryClient.cancelQueries({ queryKey: [...keys.tree] })
  return {
    prevDetail: queryClient.getQueryData<GraphProjectDetail>([...keys.detail]),
    prevTree: queryClient.getQueryData<KgTreeResponse>([...keys.tree]),
  }
}

function rollback(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: MaybeRefOrGetter<string | null | undefined>,
  snapshot: Snapshot | undefined,
) {
  if (!snapshot) return
  const keys = getKeys(projectId)
  if (snapshot.prevDetail) queryClient.setQueryData([...keys.detail], snapshot.prevDetail)
  if (snapshot.prevTree) queryClient.setQueryData([...keys.tree], snapshot.prevTree)
}

export function invalidateKgQueries(queryClient: ReturnType<typeof useQueryClient>, projectId: MaybeRefOrGetter<string | null | undefined>) {
  const pid = toValue(projectId)
  if (pid) {
    queryClient.invalidateQueries({ queryKey: ['kg', 'project', pid] })
    queryClient.invalidateQueries({ queryKey: ['kg', 'tree', pid] })
  }
}

/**
 * 将当前 KG 缓存同步到 IDB（mutation 成功后调用，避免 invalidate 产生额外请求）
 */
export function syncKgToIdb(queryClient: ReturnType<typeof useQueryClient>, projectId: MaybeRefOrGetter<string | null | undefined>) {
  const pid = toValue(projectId)
  if (!pid) return
  const detail = queryClient.getQueryData<GraphProjectDetail>(['kg', 'project', pid])
  if (detail) dbPut(STORES.KG_DETAILS, { id: pid, data: detail }).catch(console.warn)
  const tree = queryClient.getQueryData<KgTreeResponse>(['kg', 'tree', pid])
  if (tree) dbPut(STORES.KG_TREES, { id: pid, data: tree }).catch(console.warn)
}

// ==================== 共享缓存操作原语 ====================
// mutations 和 useTagKgSync 共用，保证 detail + tree 一致更新

type QC = ReturnType<typeof useQueryClient>

/** 乐观地向节点 linked_paper_ids 添加 paperId，同时更新 tree linked_paper_count */
export function patchLinkPaper(qc: QC, projectId: MaybeRefOrGetter<string | null | undefined>, nodeId: string, paperId: string) {
  const keys = getKeys(projectId)
  qc.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
    if (!old) return old
    return {
      ...old,
      nodes: old.nodes.map((n) =>
        n.id === nodeId && !n.linked_paper_ids.includes(paperId)
          ? { ...n, linked_paper_ids: [...n.linked_paper_ids, paperId] }
          : n,
      ),
    }
  })
  qc.setQueryData<KgTreeResponse>([...keys.tree], (old) => {
    if (!old) return old
    const next = structuredClone(old)
    const node = findNodeInTree(next.tree, nodeId) ?? findNodeInTree(next.orphans, nodeId)
    if (node) node.linked_paper_count++
    return next
  })
}

/** 乐观地从节点 linked_paper_ids 移除 paperId，同时更新 tree linked_paper_count */
export function patchUnlinkPaper(qc: QC, projectId: MaybeRefOrGetter<string | null | undefined>, nodeId: string, paperId: string) {
  const keys = getKeys(projectId)
  qc.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
    if (!old) return old
    return {
      ...old,
      nodes: old.nodes.map((n) =>
        n.id === nodeId ? { ...n, linked_paper_ids: n.linked_paper_ids.filter((id) => id !== paperId) } : n,
      ),
    }
  })
  qc.setQueryData<KgTreeResponse>([...keys.tree], (old) => {
    if (!old) return old
    const next = structuredClone(old)
    const node = findNodeInTree(next.tree, nodeId) ?? findNodeInTree(next.orphans, nodeId)
    if (node) node.linked_paper_count = Math.max(0, node.linked_paper_count - 1)
    return next
  })
}

/** 乐观地在缓存中创建临时节点，返回 tempId */
export function patchAddNode(
  qc: QC,
  projectId: MaybeRefOrGetter<string | null | undefined>,
  label: string,
  opts?: { description?: string; properties?: Record<string, any>; parentId?: string | null },
): string {
  const keys = getKeys(projectId)
  const parentId = opts?.parentId ?? null
  const tempNode = makeTreeNode(label, undefined, parentId)

  qc.setQueryData<KgTreeResponse>([...keys.tree], (old) => {
    if (!old) return old
    const next = structuredClone(old)
    if (parentId) {
      const parent = findNodeInTree(next.tree, parentId) ?? findNodeInTree(next.orphans, parentId)
      if (parent) {
        if (!parent.children) parent.children = []
        parent.children.push(tempNode)
      } else {
        next.orphans.push(tempNode)
      }
    } else {
      next.orphans.push(tempNode)
    }
    return next
  })

  qc.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
    if (!old) return old
    return {
      ...old,
      nodes: [...old.nodes, {
        id: tempNode.id, label, description: opts?.description ?? null,
        properties: opts?.properties ?? null, parent_id: parentId,
        is_root: !parentId, linked_paper_ids: [], linked_note_ids: [], created_at: null,
      }],
      node_count: old.node_count + 1,
    }
  })

  return tempNode.id
}

/** 用服务端真实节点替换缓存中的临时节点 */
export function patchReplaceNode(qc: QC, projectId: MaybeRefOrGetter<string | null | undefined>, tempId: string, serverNode: GraphNodeRecord) {
  const keys = getKeys(projectId)
  qc.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
    if (!old) return old
    return { ...old, nodes: old.nodes.map((n) => n.id === tempId ? serverNode : n) }
  })
  qc.setQueryData<KgTreeResponse>([...keys.tree], (old) => {
    if (!old) return old
    const next = structuredClone(old)
    const found = findNodeInTree(next.tree, tempId) ?? findNodeInTree(next.orphans, tempId)
    if (found) {
      found.id = serverNode.id
      found.label = serverNode.label
      found.description = serverNode.description
      found.properties = serverNode.properties
      found.is_root = serverNode.is_root
    }
    return next
  })
}

// ==================== Queries ====================

// 缓存 30s：library ↔ tag-graph 切换时复用缓存，避免每次 refetch 覆盖乐观更新
const KG_STALE_TIME = 30_000

export function useTagProjectQuery() {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['kg', 'tag-project'],
    queryFn: async () => {
      // IDB 优先：刷新后立即拿到 projectId，不用等后端
      if (!queryClient.getQueryData(['kg', 'tag-project'])) {
        const cached = await dbGet<{ id: string; data: any }>(STORES.KG_DETAILS, '__tag_project__').catch(() => null)
        if (cached?.data) return cached.data
      }
      const result = await kgApi.listProjects({ limit: 200, offset: 0 })
      let project = result.projects.find((item) => item.name === DEFAULT_TAG_PROJECT_NAME)
      if (!project) {
        project = await kgApi.createProject({ name: DEFAULT_TAG_PROJECT_NAME, description: DEFAULT_TAG_PROJECT_DESCRIPTION })
      }
      dbPut(STORES.KG_DETAILS, { id: '__tag_project__', data: project }).catch(console.warn)
      return project
    },
    staleTime: KG_STALE_TIME,
  })
}

export function useGraphProjectDetailQuery(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: computed(() => ['kg', 'project', toValue(projectId)]),
    queryFn: async (): Promise<GraphProjectDetail> => {
      const pid = toValue(projectId)!
      if (!queryClient.getQueryData(['kg', 'project', pid])) {
        const cached = await dbGet<{ id: string; data: GraphProjectDetail }>(STORES.KG_DETAILS, pid).catch(() => null)
        if (cached?.data) return cached.data
      }
      const result = await kgApi.getProjectDetail(pid)
      dbPut(STORES.KG_DETAILS, { id: pid, data: result }).catch(console.warn)
      return result
    },
    enabled: computed(() => !!toValue(projectId)),
    staleTime: KG_STALE_TIME,
  })
}

export function useProjectTreeQuery(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: computed(() => ['kg', 'tree', toValue(projectId)]),
    queryFn: async (): Promise<KgTreeResponse> => {
      const pid = toValue(projectId)!
      if (!queryClient.getQueryData(['kg', 'tree', pid])) {
        const cached = await dbGet<{ id: string; data: KgTreeResponse }>(STORES.KG_TREES, pid).catch(() => null)
        if (cached?.data) return cached.data
      }
      const result = await kgApi.getProjectTree(pid)
      dbPut(STORES.KG_TREES, { id: pid, data: result }).catch(console.warn)
      return result
    },
    enabled: computed(() => !!toValue(projectId)),
    staleTime: KG_STALE_TIME,
  })
}

// ==================== Node mutations (乐观更新) ====================

export function useCreateGraphNodeMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { label: string; description?: string; properties?: Record<string, any>; parent_id?: string | null }) =>
      kgApi.createNode(toValue(projectId)!, payload),

    onMutate: async (vars) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      const tempId = patchAddNode(queryClient, projectId, vars.label, {
        description: vars.description, properties: vars.properties, parentId: vars.parent_id,
      })
      return { ...snapshot, tempId }
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: (serverNode, _vars, ctx) => {
      if (ctx?.tempId) patchReplaceNode(queryClient, projectId, ctx.tempId, serverNode)
      syncKgToIdb(queryClient, projectId)
    },
  })
}

export function useUpdateGraphNodeMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, payload }: { nodeId: string; payload: { label?: string; description?: string; properties?: Record<string, any> } }) =>
      kgApi.updateNode(nodeId, payload),

    onMutate: async ({ nodeId, payload }) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      const keys = getKeys(projectId)

      // 记录旧 label（用于跨系统同步重命名）
      const detail = queryClient.getQueryData<GraphProjectDetail>([...keys.detail])
      const oldLabel = detail?.nodes.find((n) => n.id === nodeId)?.label ?? null

      // 乐观更新 tree
      queryClient.setQueryData<KgTreeResponse>([...keys.tree], (old) => {
        if (!old) return old
        const next = structuredClone(old)
        const node = findNodeInTree(next.tree, nodeId) ?? findNodeInTree(next.orphans, nodeId)
        if (node) {
          if (payload.label !== undefined) node.label = payload.label
          if (payload.description !== undefined) node.description = payload.description
        }
        return next
      })

      // 乐观更新 detail
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        return {
          ...old,
          nodes: old.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, ...payload }
              : n,
          ),
        }
      })

      return { ...snapshot, oldLabel }
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: (serverNode) => {
      const keys = getKeys(projectId)
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        return { ...old, nodes: old.nodes.map((n) => n.id === serverNode.id ? serverNode : n) }
      })
      queryClient.setQueryData<KgTreeResponse>([...keys.tree], (old) => {
        if (!old) return old
        const next = structuredClone(old)
        const found = findNodeInTree(next.tree, serverNode.id) ?? findNodeInTree(next.orphans, serverNode.id)
        if (found) {
          found.label = serverNode.label
          found.description = serverNode.description
          found.properties = serverNode.properties
        }
        return next
      })
      syncKgToIdb(queryClient, projectId)
    },
  })
}

export function useDeleteGraphNodeMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (nodeId: string) => kgApi.deleteNode(nodeId),

    onMutate: async (nodeId) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      const keys = getKeys(projectId)

      // 乐观更新 tree：移除节点，子节点提升到祖父
      queryClient.setQueryData<KgTreeResponse>([...keys.tree], (old) => {
        if (!old) return old
        const next = structuredClone(old)
        const removed = removeNodeFromTree(next.tree, nodeId) ?? removeNodeFromTree(next.orphans, nodeId)
        if (removed?.children?.length) {
          // 子节点变为 orphans（简化处理，服务端会 reparent 到祖父）
          next.orphans.push(...removed.children)
        }
        return next
      })

      // 乐观更新 detail：移除节点和相关边
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        return {
          ...old,
          nodes: old.nodes.filter((n) => n.id !== nodeId),
          edges: old.edges.filter((e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId),
          node_count: Math.max(0, old.node_count - 1),
        }
      })

      return snapshot
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: () => {
      // 服务端将子节点 reparent 到祖父，而乐观更新放到了 orphans，需要 refetch tree 纠正
      const pid = toValue(projectId)
      if (pid) queryClient.invalidateQueries({ queryKey: ['kg', 'tree', pid] })
      syncKgToIdb(queryClient, projectId)
    },
  })
}

export function useSetNodeParentMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, parentId }: { nodeId: string; parentId: string | null }) =>
      kgApi.setNodeParent(nodeId, parentId),

    onMutate: async ({ nodeId, parentId }) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      const keys = getKeys(projectId)

      // 乐观更新 tree：从旧位置移除，放到新父节点下或 orphans
      queryClient.setQueryData<KgTreeResponse>([...keys.tree], (old) => {
        if (!old) return old
        const next = structuredClone(old)
        const removed = removeNodeFromTree(next.tree, nodeId) ?? removeNodeFromTree(next.orphans, nodeId)
        if (!removed) return next

        if (parentId) {
          const newParent = findNodeInTree(next.tree, parentId) ?? findNodeInTree(next.orphans, parentId)
          if (newParent) {
            if (!newParent.children) newParent.children = []
            newParent.children.push(removed)
          } else {
            next.orphans.push(removed)
          }
        } else {
          next.orphans.push(removed)
        }
        return next
      })

      // 乐观更新 detail
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        return {
          ...old,
          nodes: old.nodes.map((n) => n.id === nodeId ? { ...n, parent_id: parentId } : n),
        }
      })

      return snapshot
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: (serverNode) => {
      const keys = getKeys(projectId)
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        return { ...old, nodes: old.nodes.map((n) => n.id === serverNode.id ? serverNode : n) }
      })
      // tree 的层级结构由服务端决定，乐观更新不一定准确，refetch 纠正
      const pid = toValue(projectId)
      if (pid) queryClient.invalidateQueries({ queryKey: ['kg', 'tree', pid] })
      syncKgToIdb(queryClient, projectId)
    },
  })
}

// ==================== Edge mutations ====================

export function useCreateGraphEdgeMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { source_node_id: string; target_node_id: string; relation_type?: string; description?: string }) =>
      kgApi.createEdge(toValue(projectId)!, payload),

    onMutate: async (vars) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      const keys = getKeys(projectId)
      const tempId = crypto.randomUUID()
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        const tempEdge: GraphEdgeRecord = {
          id: tempId,
          source_node_id: vars.source_node_id,
          target_node_id: vars.target_node_id,
          relation_type: vars.relation_type ?? 'related_to',
          description: vars.description ?? null,
          created_at: null,
        }
        return { ...old, edges: [...old.edges, tempEdge], edge_count: old.edge_count + 1 }
      })
      return { ...snapshot, tempId }
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: (serverEdge, _vars, ctx) => {
      const keys = getKeys(projectId)
      if (ctx?.tempId) {
        queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
          if (!old) return old
          return { ...old, edges: old.edges.map((e) => e.id === ctx.tempId ? serverEdge : e) }
        })
      }
      syncKgToIdb(queryClient, projectId)
    },
  })
}

export function useUpdateGraphEdgeMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ edgeId, payload }: { edgeId: string; payload: { relation_type?: string; description?: string } }) =>
      kgApi.updateEdge(edgeId, payload),

    onMutate: async ({ edgeId, payload }) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      const keys = getKeys(projectId)
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        return { ...old, edges: old.edges.map((e) => e.id === edgeId ? { ...e, ...payload } : e) }
      })
      return snapshot
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: (serverEdge) => {
      const keys = getKeys(projectId)
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        return { ...old, edges: old.edges.map((e) => e.id === serverEdge.id ? serverEdge : e) }
      })
      syncKgToIdb(queryClient, projectId)
    },
  })
}

export function useDeleteGraphEdgeMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (edgeId: string) => kgApi.deleteEdge(edgeId),

    onMutate: async (edgeId) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      const keys = getKeys(projectId)
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        return { ...old, edges: old.edges.filter((e) => e.id !== edgeId), edge_count: Math.max(0, old.edge_count - 1) }
      })
      return snapshot
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: () => syncKgToIdb(queryClient, projectId),
  })
}

// ==================== Association mutations ====================

export function useLinkPaperMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, paperId }: { nodeId: string; paperId: string }) =>
      kgApi.linkPaperToNode(nodeId, paperId),

    onMutate: async ({ nodeId, paperId }) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      patchLinkPaper(queryClient, projectId, nodeId, paperId)
      return snapshot
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: () => syncKgToIdb(queryClient, projectId),
  })
}

export function useUnlinkPaperMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, paperId }: { nodeId: string; paperId: string }) =>
      kgApi.unlinkPaperFromNode(nodeId, paperId),

    onMutate: async ({ nodeId, paperId }) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      patchUnlinkPaper(queryClient, projectId, nodeId, paperId)
      return snapshot
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: () => syncKgToIdb(queryClient, projectId),
  })
}

export function useLinkNoteMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, noteId }: { nodeId: string; noteId: number }) =>
      kgApi.linkNoteToNode(nodeId, noteId),

    onMutate: async ({ nodeId, noteId }) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      const keys = getKeys(projectId)
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        return {
          ...old,
          nodes: old.nodes.map((n) =>
            n.id === nodeId && !n.linked_note_ids.includes(noteId)
              ? { ...n, linked_note_ids: [...n.linked_note_ids, noteId] }
              : n,
          ),
        }
      })
      return snapshot
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: () => syncKgToIdb(queryClient, projectId),
  })
}

export function useUnlinkNoteMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, noteId }: { nodeId: string; noteId: number }) =>
      kgApi.unlinkNoteFromNode(nodeId, noteId),

    onMutate: async ({ nodeId, noteId }) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      const keys = getKeys(projectId)
      queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
        if (!old) return old
        return {
          ...old,
          nodes: old.nodes.map((n) =>
            n.id === nodeId ? { ...n, linked_note_ids: n.linked_note_ids.filter((id) => id !== noteId) } : n,
          ),
        }
      })
      return snapshot
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: () => syncKgToIdb(queryClient, projectId),
  })
}

export function useRecomposeMutation(projectId: MaybeRefOrGetter<string | null | undefined>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: RecomposePayload) => kgApi.recompose(payload),

    onMutate: async (vars) => {
      const snapshot = await cancelAndSnapshot(queryClient, projectId)
      const keys = getKeys(projectId)

      if (vars.operation === 'swap_direction' && vars.edge_id) {
        queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
          if (!old) return old
          return {
            ...old,
            edges: old.edges.map((e) =>
              e.id === vars.edge_id ? { ...e, source_node_id: e.target_node_id, target_node_id: e.source_node_id } : e,
            ),
          }
        })
      } else if (vars.operation === 'reconnect_edge' && vars.edge_id && vars.target_node_id) {
        queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
          if (!old) return old
          return {
            ...old,
            edges: old.edges.map((e) =>
              e.id === vars.edge_id ? { ...e, target_node_id: vars.target_node_id! } : e,
            ),
          }
        })
      } else if (vars.operation === 'merge_nodes' && vars.node1_id && vars.node2_id) {
        // 乐观地移除被合并的节点（node2），将其关联的边重定向到 node1
        queryClient.setQueryData<GraphProjectDetail>([...keys.detail], (old) => {
          if (!old) return old
          const edges = old.edges.map((e) => {
            let edge = e
            if (e.source_node_id === vars.node2_id) edge = { ...edge, source_node_id: vars.node1_id! }
            if (e.target_node_id === vars.node2_id) edge = { ...edge, target_node_id: vars.node1_id! }
            return edge
          }).filter((e) => e.source_node_id !== e.target_node_id) // 去掉自环
          return {
            ...old,
            nodes: old.nodes
              .filter((n) => n.id !== vars.node2_id)
              .map((n) => n.parent_id === vars.node2_id ? { ...n, parent_id: vars.node1_id! } : n),
            edges,
            node_count: Math.max(0, old.node_count - 1),
          }
        })
        queryClient.setQueryData<KgTreeResponse>([...keys.tree], (old) => {
          if (!old) return old
          const next = structuredClone(old)
          const removed = removeNodeFromTree(next.tree, vars.node2_id!) ?? removeNodeFromTree(next.orphans, vars.node2_id!)
          if (removed?.children?.length) {
            const node1 = findNodeInTree(next.tree, vars.node1_id!) ?? findNodeInTree(next.orphans, vars.node1_id!)
            if (node1) {
              if (!node1.children) node1.children = []
              node1.children.push(...removed.children)
            } else {
              next.orphans.push(...removed.children)
            }
          }
          return next
        })
      }

      return snapshot
    },
    onError: (_err, _vars, ctx) => { rollback(queryClient, projectId, ctx); invalidateKgQueries(queryClient, projectId) },
    onSuccess: () => {
      // recompose 涉及合并/重连等复杂操作，乐观更新不一定完整，refetch 确保一致
      invalidateKgQueries(queryClient, projectId)
    },
  })
}
