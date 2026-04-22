<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { KgTreeNode } from '../../api'
import { useTagStore } from '../../stores/tag'
import {
  useTagProjectQuery,
  useProjectTreeQuery,
  useGraphProjectDetailQuery,
  useCreateGraphNodeMutation,
  useSetNodeParentMutation,
} from '../../composables/queries/useKgQueries'
import { useTagKgSync } from '../../composables/queries/useTagKgSync'

const { t } = useI18n()

const props = defineProps<{
  selectedTag: string
  folders: string[]
  uncategorizedCount?: number
}>()

const emit = defineEmits<{
  select: [tag: string]
  'paper-drop': [payload: { pdfId: string; tag: string }]
  'change-color': [tagNode: KgTreeNode]
}>()

const tagStore = useTagStore()

// ==================== Data ====================
const tagProjectQuery = useTagProjectQuery()
const projectId = computed(() => tagProjectQuery.data.value?.id ?? null)
const treeQuery = useProjectTreeQuery(projectId)
// 预加载 project detail，切到图谱页时直接从缓存读
useGraphProjectDetailQuery(projectId)

const createNodeMutation = useCreateGraphNodeMutation(projectId)
const setParentMutation = useSetNodeParentMutation(projectId)
const sync = useTagKgSync()

// ==================== Tree state ====================
const expandedIds = ref<Set<string>>(new Set())
const hasTree = computed(() => {
  const data = treeQuery.data.value
  return data && (data.tree.length > 0 || data.orphans.length > 0)
})

// Collect all nodes flat for "move to" submenu
const allNodes = computed<KgTreeNode[]>(() => {
  const data = treeQuery.data.value
  if (!data) return []
  const result: KgTreeNode[] = []
  function collect(nodes: KgTreeNode[]) {
    for (const n of nodes) {
      result.push(n)
      if (n.children?.length) collect(n.children)
    }
  }
  collect(data.tree)
  collect(data.orphans)
  return result
})

type FlatItem = { node: KgTreeNode; depth: number }

function flattenTree(nodes: KgTreeNode[], depth: number): FlatItem[] {
  const sortedNodes = [...nodes].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN', { numeric: true }))
  const result: FlatItem[] = []
  for (const node of sortedNodes) {
    result.push({ node, depth })
    if (node.children?.length && expandedIds.value.has(node.id)) {
      result.push(...flattenTree(node.children, depth + 1))
    }
  }
  return result
}

const flatItems = computed<FlatItem[]>(() => {
  const data = treeQuery.data.value
  if (!data) return []
  const rootNodes = [...data.tree, ...data.orphans]
  return flattenTree(rootNodes, 0)
})

function toggleExpand(nodeId: string, event: Event) {
  event.stopPropagation()
  const next = new Set(expandedIds.value)
  next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId)
  expandedIds.value = next
}

// ==================== Drag & Drop ====================
const dragNodeId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null) // 'root' or node id

function isPaperDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('application/x-paper-id') ?? false
}

function onDragStart(event: DragEvent, node: KgTreeNode) {
  dragNodeId.value = node.id
  event.dataTransfer!.effectAllowed = 'move'
  event.dataTransfer!.setData('text/plain', node.id)
}

function onDragEnd() {
  dragNodeId.value = null
  dropTargetId.value = null
}

function onDragOver(event: DragEvent, targetId: string) {
  const paperDrag = isPaperDrag(event)
  if (paperDrag) {
    // 文献拖拽只允许放到具体标签上，不允许放到 root
    if (targetId === 'root') return
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'link'
    dropTargetId.value = targetId
    return
  }
  if (!dragNodeId.value || dragNodeId.value === targetId) return
  // 禁止拖到自己的后代上（防止循环）
  if (isDescendant(targetId, dragNodeId.value)) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'
  dropTargetId.value = targetId
}

function onDragLeave(event: DragEvent, targetId: string) {
  // 只在真正离开时清除（忽略子元素冒泡）
  const related = event.relatedTarget as HTMLElement | null
  if (related && (event.currentTarget as HTMLElement).contains(related)) return
  if (dropTargetId.value === targetId) dropTargetId.value = null
}

function onDrop(event: DragEvent, targetId: string) {
  event.preventDefault()

  // 处理文献拖拽到标签
  const paperId = event.dataTransfer?.getData('application/x-paper-id')
  if (paperId && targetId !== 'root') {
    const node = allNodes.value.find(n => n.id === targetId)
    if (node) {
      emit('paper-drop', { pdfId: paperId, tag: node.label })
    }
    dropTargetId.value = null
    return
  }

  // 处理标签节点拖拽重排
  if (!dragNodeId.value || dragNodeId.value === targetId) return
  if (targetId !== 'root' && isDescendant(targetId, dragNodeId.value)) return
  const newParentId = targetId === 'root' ? null : targetId
  setParentMutation.mutate({ nodeId: dragNodeId.value, parentId: newParentId })
  dragNodeId.value = null
  dropTargetId.value = null
}

// ==================== Node Action Menu ====================
const actionMenuNodeId = ref<string | null>(null)
const moveSubmenu = ref(false)

function toggleActionMenu(event: MouseEvent, node: KgTreeNode) {
  event.stopPropagation()
  const isSameNode = actionMenuNodeId.value === node.id
  actionMenuNodeId.value = isSameNode ? null : node.id
  moveSubmenu.value = false
}

function closeActionMenu() {
  actionMenuNodeId.value = null
  moveSubmenu.value = false
}

function onDocMousedown(e: MouseEvent) {
  const target = e.target as HTMLElement
  // 关闭操作菜单
  if (actionMenuNodeId.value && !target.closest('.tag-actions-menu') && !target.closest('.tag-actions-trigger')) closeActionMenu()
  // 点击非输入框位置 → 关闭行内编辑
  if (target.tagName === 'INPUT') return
  if (renamingId.value !== null) {
    renameValue.value.trim() ? commitRename() : cancelRename()
  }
}
onMounted(() => document.addEventListener('mousedown', onDocMousedown, true))
onUnmounted(() => document.removeEventListener('mousedown', onDocMousedown, true))

// ==================== Inline Rename ====================
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

function startRename(node: KgTreeNode) {
  closeActionMenu()
  renamingId.value = node.id
  renameValue.value = node.label
  nextTick(() => renameInputRef.value?.focus())
}

function changeColor(node: KgTreeNode) {
  closeActionMenu()
  emit('change-color', node)
}

function commitRename() {
  if (!renamingId.value || !renameValue.value.trim()) {
    renamingId.value = null
    return
  }
  const oldNode = allNodes.value.find((n) => n.id === renamingId.value)
  if (oldNode && renameValue.value.trim() !== oldNode.label) {
    const oldColor = tagStore.getTagColor(oldNode.label)
    sync.updateNodeLabel(renamingId.value, renameValue.value.trim())
    tagStore.setTagColor(renameValue.value.trim(), oldColor)
  }
  renamingId.value = null
}

function cancelRename() {
  renamingId.value = null
}

// ==================== Inline Create ====================
const createModalParentId = ref<string | null | 'root'>(null)
const showCreateModal = ref(false)
const createValue = ref('')
const createError = ref('')
const createModalInputRef = ref<HTMLInputElement | null>(null)
const isCreating = ref(false)
const pendingCreateKeys = ref<Set<string>>(new Set())

function startCreateChild(parentNode: KgTreeNode | null) {
  closeActionMenu()
  if (parentNode) {
    expandedIds.value = new Set([...expandedIds.value, parentNode.id])
  }
  createModalParentId.value = parentNode ? parentNode.id : 'root'
  createValue.value = ''
  createError.value = ''
  showCreateModal.value = true
  nextTick(() => createModalInputRef.value?.focus())
}

function getSiblingNodes(parentId: string | null | 'root'): KgTreeNode[] {
  const data = treeQuery.data.value
  if (!data) return []
  if (parentId === 'root') return [...data.tree, ...data.orphans]
  const parent = allNodes.value.find((node) => node.id === parentId)
  return parent?.children ?? []
}

function hasDuplicateSiblingName(parentId: string | null | 'root', nextLabel: string): boolean {
  const normalized = nextLabel.trim().toLocaleLowerCase()
  if (!normalized) return false
  return getSiblingNodes(parentId).some((node) => node.label.trim().toLocaleLowerCase() === normalized)
}

function getPendingCreateKey(parentId: string | null | 'root', label: string): string {
  const parentPart = parentId ?? 'root'
  return `${parentPart}::${label.trim().toLocaleLowerCase()}`
}

function commitCreate() {
  const nextLabel = createValue.value.trim()
  const parentId = createModalParentId.value

  if (!nextLabel) {
    cancelCreate()
    return
  }
  if (isCreating.value) {
    return
  }
  const pendingKey = getPendingCreateKey(parentId, nextLabel)
  if (pendingCreateKeys.value.has(pendingKey) || hasDuplicateSiblingName(parentId, nextLabel)) {
    createError.value = '同级标签名称不能重复'
    return
  }

  isCreating.value = true
  pendingCreateKeys.value = new Set([...pendingCreateKeys.value, pendingKey])

  showCreateModal.value = false
  createValue.value = ''
  createError.value = ''

  createNodeMutation.mutate({
    label: nextLabel,
    parent_id: parentId === 'root' ? undefined : (parentId ?? undefined),
  }, {
    onSettled: () => {
      isCreating.value = false
      const nextPending = new Set(pendingCreateKeys.value)
      nextPending.delete(pendingKey)
      pendingCreateKeys.value = nextPending
    },
    onSuccess: () => {
      createError.value = ''
    },
    onError: () => {
      showCreateModal.value = true
      createModalParentId.value = parentId
      createValue.value = nextLabel
      createError.value = '创建失败，请稍后重试'
      nextTick(() => createModalInputRef.value?.focus())
    }
  })
}

function cancelCreate() {
  if (isCreating.value) return
  showCreateModal.value = false
  createModalParentId.value = null
  createError.value = ''
}

// ==================== Delete ====================
function handleDelete(node: KgTreeNode) {
  closeActionMenu()
  const childInfo = node.children?.length ? `（${node.children.length} 个子标签将提升到上层）` : ''
  if (!window.confirm(`确定删除标签"${node.label}"吗？${childInfo}关联论文上的该标签也会被清除。`)) return
  sync.deleteNode(node.id)
  if (props.selectedTag === node.label) emit('select', 'all')
}

// ==================== Move (set parent) ====================
function handleMove(node: KgTreeNode, newParentId: string | null) {
  closeActionMenu()
  setParentMutation.mutate({ nodeId: node.id, parentId: newParentId })
}

// Check if candidate is descendant of nodeId (prevent cycles)
function isDescendant(candidateId: string, ancestorId: string): boolean {
  const visited = new Set<string>()
  function check(id: string): boolean {
    if (visited.has(id)) return false
    visited.add(id)
    const node = allNodes.value.find((n) => n.id === id)
    if (!node) return false
    for (const child of node.children || []) {
      if (child.id === candidateId) return true
      if (check(child.id)) return true
    }
    return false
  }
  return check(ancestorId)
}

function getMoveTargets(node: KgTreeNode) {
  return allNodes.value
    .filter((n) => n.id !== node.id && !isDescendant(n.id, node.id))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN', { numeric: true }))
}

// 当前选中的标签对应的节点
const selectedNode = computed(() => {
  if (props.selectedTag === 'all') return null
  return allNodes.value.find((n) => n.label === props.selectedTag) ?? null
})

function handleTopCreate() {
  startCreateChild(selectedNode.value)
}

watch(createValue, () => {
  if (createError.value) createError.value = ''
})

</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 全部文献 -->
    <div
      @click="emit('select', 'all')"
      :class="[
        'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all',
        selectedTag === 'all'
          ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
      ]"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
      全部文献
    </div>

    <div class="h-3"></div>
    <div
      class="flex items-center justify-between mb-2 rounded-lg px-1 py-1 transition-colors"
      :class="dropTargetId === 'root' ? 'bg-primary-100 dark:bg-primary-900/30 ring-2 ring-primary-400/50' : ''"
      @dragover.prevent="onDragOver($event, 'root')"
      @dragleave="onDragLeave($event, 'root')"
      @drop="onDrop($event, 'root')"
    >
      <span class="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">分类标签</span>
      <button
        class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        :title="selectedNode ? `在「${selectedNode.label}」下新建子标签` : '新建顶层标签'"
        @click="handleTopCreate"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
      </button>
    </div>

    <!-- 树状标签 -->
    <div v-if="hasTree || (props.uncategorizedCount ?? 0) > 0" class="flex-1 overflow-y-auto space-y-0.5">
      <template v-for="item in flatItems" :key="item.node.id">
        <div
          @click="expandedIds = new Set([...expandedIds, item.node.id]); emit('select', selectedTag === item.node.label ? 'all' : item.node.label)"
          draggable="true"
          @dragstart="onDragStart($event, item.node)"
          @dragend="onDragEnd"
          @dragover="onDragOver($event, item.node.id)"
          @dragleave="onDragLeave($event, item.node.id)"
          @drop="onDrop($event, item.node.id)"
          :class="[
            'flex items-center gap-1.5 py-1.5 pr-2 rounded-lg cursor-pointer transition-all group',
            dropTargetId === item.node.id
              ? 'ring-2 ring-primary-400/50 bg-primary-50 dark:bg-primary-900/30'
              : selectedTag === item.node.label
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
            dragNodeId === item.node.id ? 'opacity-40' : '',
          ]"
          :style="{ paddingLeft: `${10 + item.depth * 18}px` }"
        >
          <!-- 展开/折叠 -->
          <button
            v-if="item.node.children?.length"
            @click="toggleExpand(item.node.id, $event)"
            class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-transform duration-200 flex-shrink-0"
            :class="{ 'rotate-90': expandedIds.has(item.node.id) }"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
          </button>
          <span v-else class="w-4 flex-shrink-0"></span>

          <!-- 文件夹/标签图标 -->
          <svg v-if="item.node.children?.length" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" :style="{ color: tagStore.getTagColor(item.node.label) }">
            <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <svg v-else class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" :style="{ color: tagStore.getTagColor(item.node.label) }">
            <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>

          <!-- 标签名 / 重命名输入 -->
          <template v-if="renamingId === item.node.id">
            <input
              ref="renameInputRef"
              v-model="renameValue"
              type="text"
              class="flex-1 min-w-0 rounded-md border border-primary-400 bg-white dark:bg-gray-900 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 dark:text-white"
              @click.stop
              @keyup.enter="commitRename"
              @keyup.escape="cancelRename"
              @blur="renameValue.trim() ? commitRename() : cancelRename()"
            />
          </template>
          <span v-else class="truncate flex-1 text-sm">{{ item.node.label }}</span>

          <!-- 文献计数 -->
          <span v-if="item.node.linked_paper_count > 0 && renamingId !== item.node.id" class="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
            {{ item.node.linked_paper_count }}
          </span>

          <div v-if="renamingId !== item.node.id" class="relative flex-shrink-0" @click.stop>
            <button
              class="tag-actions-trigger p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="标签操作"
              @click="toggleActionMenu($event, item.node)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5h.01M12 12h.01M12 19h.01" /></svg>
            </button>

            <div
              v-if="actionMenuNodeId === item.node.id"
              class="tag-actions-menu absolute right-0 top-full mt-1 z-[120] min-w-[176px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1 text-sm"
            >
              <button class="ctx-item" @click="startCreateChild(item.node)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                添加子标签
              </button>
              <button class="ctx-item" @click="changeColor(item.node)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 014-4h2a4 4 0 014 4H7zM3 13a4 4 0 118 0v4H3v-4zm10 0a4 4 0 118 0v4h-8v-4z" /></svg>
                更改颜色
              </button>
              <button class="ctx-item" @click="startRename(item.node)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                重命名
              </button>

              <div class="relative">
                <button class="ctx-item" @click.stop="moveSubmenu = !moveSubmenu">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
                  移动到…
                  <svg class="w-3 h-3 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                </button>
                <div
                  v-if="moveSubmenu"
                  class="absolute left-full top-0 ml-1 z-[121] min-w-[140px] max-h-[240px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1"
                >
                  <button class="ctx-item text-primary-600 dark:text-primary-400" @click="handleMove(item.node, null)">
                    顶层（无父节点）
                  </button>
                  <div class="border-t border-gray-100 dark:border-gray-700 my-0.5"></div>
                  <button
                    v-for="target in getMoveTargets(item.node)"
                    :key="target.id"
                    class="ctx-item"
                    @click="handleMove(item.node, target.id)"
                  >
                    {{ target.label }}
                  </button>
                </div>
              </div>

              <div class="border-t border-gray-100 dark:border-gray-700 my-0.5"></div>
              <button class="ctx-item text-red-500 dark:text-red-400" @click="handleDelete(item.node)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                删除
              </button>
            </div>
          </div>
        </div>

      </template>

      <!-- 未分类文档分组 -->
      <div
        v-if="(props.uncategorizedCount ?? 0) > 0"
        :class="[
          'flex items-center gap-1.5 py-1.5 pr-2 rounded-lg cursor-pointer transition-all group',
          selectedTag === '__uncategorized__'
            ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
        ]"
        style="padding-left: 10px"
        @click="emit('select', '__uncategorized__')"
      >
        <span class="w-4 flex-shrink-0"></span>
        <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" style="color: #9ca3af">
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        <span class="truncate flex-1 text-sm">{{ t('sidebar.uncategorized') }}</span>
        <span class="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{{ props.uncategorizedCount }}</span>
      </div>
    </div>

    <!-- 回退：平铺标签列表 -->
    <div v-else-if="folders.length" class="flex-1 overflow-y-auto space-y-1">
      <div
        v-for="folder in folders"
        :key="folder"
        @click="emit('select', folder)"
        :class="[
          'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all',
          selectedTag === folder
            ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
        ]"
      >
        <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" :style="{ color: tagStore.getTagColor(folder) }">
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        <span class="truncate flex-1 text-sm">{{ folder }}</span>
      </div>
    </div>

    <div v-else class="flex-1 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 px-4 text-center">
      暂无标签，点击右上角 + 创建
    </div>

    <!-- 创建标签弹窗 -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
      @mousedown.self="cancelCreate"
    >
      <div class="popup-surface create-modal-surface w-full max-w-md overflow-hidden" style="animation: pop-in var(--duration-slow) var(--ease-out);">
        <div class="popup-header create-modal-header">
          <div class="create-header-copy">
            <div class="popup-title">{{ createModalParentId && createModalParentId !== 'root' ? '新建子标签' : '新建标签' }}</div>
          </div>
          <button class="popup-icon-btn" @click="cancelCreate" title="关闭">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="popup-body create-modal-body">
          <input
            ref="createModalInputRef"
            v-model="createValue"
            type="text"
            class="popup-input w-full"
            :placeholder="createModalParentId && createModalParentId !== 'root' ? '子标签名称...' : '标签名称...'"
            @keyup.enter="commitCreate"
            @keyup.escape="cancelCreate"
          />
          <p v-if="createError" class="text-sm text-red-500">{{ createError }}</p>
          <div class="flex justify-end gap-2 mt-2">
            <button class="popup-button" @click="cancelCreate">取消</button>
            <button
              class="popup-button popup-button--accent"
              :disabled="!createValue.trim() || isCreating"
              @click="commitCreate"
            >
              创建
            </button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  text-align: left;
  font-size: 13px;
  color: rgb(55 65 81);
  transition: background 0.15s;
  cursor: pointer;
  border: none;
  background: none;
}
.ctx-item:hover {
  background: rgb(243 244 246);
}
:root.dark .ctx-item,
.dark .ctx-item {
  color: rgb(209 213 219);
}
:root.dark .ctx-item:hover,
.dark .ctx-item:hover {
  background: rgb(55 65 81);
}

.create-modal-surface {
  min-height: 220px;
}
.create-modal-header {
  min-height: calc(var(--popup-header-height) + 12px);
}
.create-header-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.create-modal-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-3);
  min-height: 140px;
}
</style>
