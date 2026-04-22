<script setup lang="ts">
/*
----------------------------------------------------------------------
                            左侧边栏组件
----------------------------------------------------------------------
*/ 

// ------------------------- 导入依赖与 store -------------------------
// 从 Vue 导入响应式 API，以及需要的 store
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLibraryStore } from '../../stores/library'
import { usePdfStore } from '../../stores/pdf'
import { useChatStore } from '../../stores/chat'
import { useRoadmapStore } from '../../stores/roadmap'
import { useAuthStore } from '../../stores/auth'
import { useThemeStore } from '../../stores/theme'
import { useRouter } from 'vue-router'
import { useDocumentsQuery, useDeleteDocumentMutation, useUploadMutation, useRenameDocumentMutation, useAddTagMutation } from '../../composables/queries/useLibraryQueries'
import { usePdfStatusQuery } from '../../composables/queries/usePdfQueries'
import { useImportLinkFlow } from '../../composables/useImportLinkFlow'
import { trackEvent } from '../../utils/tracking'
import UploadModal from './UploadModal.vue'
import type { PdfDocument, RecentImportTask } from '../../types'

import { useStorage } from '@vueuse/core'

const { t } = useI18n()

type RecentListItem =
  | {
      type: 'document'
      id: string
      timestamp: number
      document: PdfDocument
    }
  | {
      type: 'import'
      id: string
      timestamp: number
      task: RecentImportTask
    }

// ------------------------- 初始化 store 实例 -------------------------
// 组合式 store 实例用于访问应用级状态和方法
const libraryStore = useLibraryStore()
const pdfStore = usePdfStore()
const chatStore = useChatStore()
const roadmapStore = useRoadmapStore()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const router = useRouter()

// ------------------------- Vue Query -------------------------
const { data: documents } = useDocumentsQuery()
const deleteDocMutation = useDeleteDocumentMutation()
const renameDocMutation = useRenameDocumentMutation()
const addTagMutation = useAddTagMutation()
const uploadMutation = useUploadMutation()
const { startImportLink } = useImportLinkFlow()

// 启动当前文档的状态轮询
usePdfStatusQuery(computed(() => libraryStore.currentDocumentId))

const realDocuments = computed(() => (documents.value || []).filter(doc => !doc.id.startsWith('temp-')))

// 从库中获取所有唯一标签用于侧边栏展示
const uniqueTags = computed(() => {
  const tags = new Set<string>()
  realDocuments.value.forEach(doc => {
    doc.tags?.forEach(t => tags.add(t))
  })
  return Array.from(tags).sort()
})

const recentItems = computed<RecentListItem[]>(() => {
  const readMap = libraryStore.lastReadMap
  const recentDocuments = realDocuments.value
    .filter(doc => readMap[doc.id])
    .map((document) => ({
      type: 'document' as const,
      id: document.id,
      timestamp: readMap[document.id]!,
      document,
    }))

  const recentImports = libraryStore.recentImportTasks.map((task) => ({
    type: 'import' as const,
    id: task.id,
    timestamp: task.updatedAt,
    task,
  }))

  return [...recentImports, ...recentDocuments]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 8)
})

// 全部文献按最后阅读时间倒序排列，未阅读过的按添加时间排
const sortedDocuments = computed(() => {
  const readMap = libraryStore.lastReadMap
  return [...realDocuments.value].sort((a, b) => {
    const timeA = readMap[a.id] ?? new Date(a.uploadedAt).getTime()
    const timeB = readMap[b.id] ?? new Date(b.uploadedAt).getTime()
    return timeB - timeA
  })
})

// ---- 标签颜色系统 (localStorage) ----
const TAG_COLORS_KEY = 'readme_tag_colors'
const PRESET_COLORS = [
  '#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
  '#e11d48', '#84cc16', '#a855f7', '#0ea5e9', '#d946ef',
]

function loadTagColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TAG_COLORS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
const tagColors = ref<Record<string, string>>(loadTagColors())

function getTagColor(tag: string): string {
  if (tagColors.value[tag]) return tagColors.value[tag]
  // 自动分配一个基于 hash 的预设颜色
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  return PRESET_COLORS[Math.abs(hash) % PRESET_COLORS.length] as string
}

// 标签展开/折叠状态
const expandedTags = ref<Set<string>>(new Set())
let hoverExpandTimer: ReturnType<typeof setTimeout> | null = null
const hoveredTag = ref<string | null>(null)

function toggleTagExpand(tag: string) {
  clearHoverExpandTimer(tag)
  const next = new Set(expandedTags.value)
  if (next.has(tag)) next.delete(tag)
  else next.add(tag)
  expandedTags.value = next
}

/** 如果标签没展开，则展开标签 */
function expandTag(tag: string) {
  if (expandedTags.value.has(tag)) return
  expandedTags.value = new Set([...expandedTags.value, tag])
}

function clearHoverExpandTimer(tag?: string) {
  if (tag && hoveredTag.value !== tag) return
  if (hoverExpandTimer) {
    clearTimeout(hoverExpandTimer)
    hoverExpandTimer = null
  }
  if (!tag || hoveredTag.value === tag) hoveredTag.value = null
}

function scheduleHoverExpand(tag: string) {
  clearHoverExpandTimer()
  if (expandedTags.value.has(tag)) return

  hoveredTag.value = tag
  hoverExpandTimer = setTimeout(() => {
    if (hoveredTag.value === tag) expandTag(tag)
    hoverExpandTimer = null
  }, 1000)
}

/** 获取标签下的文档 */
function docsForTag(tag: string) {
  return sortedDocuments.value.filter(doc => doc.tags?.includes(tag))
}

// 标签拖拽状态（论文 -> 标签）
const draggedDocId = ref<string | null>(null)
const dropTargetTag = ref<string | null>(null)

function isPaperDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('application/x-paper-id') ?? false
}

function handleDocumentDragStart(event: DragEvent, doc: PdfDocument) {
  if (doc.id.startsWith('temp-')) return
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) return

  draggedDocId.value = doc.id
  dataTransfer.effectAllowed = 'link'
  dataTransfer.setData('application/x-paper-id', doc.id)
  dataTransfer.setData('text/plain', doc.name || doc.id)

  const ghost = document.createElement('div')
  ghost.textContent = doc.name || doc.id
  Object.assign(ghost.style, {
    maxWidth: '220px',
    padding: '6px 12px',
    borderRadius: '8px',
    background: '#fff',
    border: '1px solid #e5e7eb',
    boxShadow: '0 4px 12px rgba(0,0,0,.12)',
    fontSize: '12px',
    fontWeight: '600',
    color: '#1f2937',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
  })
  document.body.appendChild(ghost)
  dataTransfer.setDragImage(ghost, 0, 0)
  requestAnimationFrame(() => ghost.remove())
}

function handleDocumentDragEnd() {
  clearHoverExpandTimer()
  draggedDocId.value = null
  dropTargetTag.value = null
}

function handleTagDragOver(event: DragEvent, tag: string) {
  if (!isPaperDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'link'
  if (dropTargetTag.value !== tag) {
    scheduleHoverExpand(tag)
    dropTargetTag.value = tag
  }
}

function handleTagDragLeave(event: DragEvent, tag: string) {
  const related = event.relatedTarget as HTMLElement | null
  if (related && (event.currentTarget as HTMLElement).contains(related)) return
  if (dropTargetTag.value === tag) {
    clearHoverExpandTimer(tag)
    dropTargetTag.value = null
  }
}

function handleTagDrop(event: DragEvent, tag: string) {
  event.preventDefault()
  clearHoverExpandTimer(tag)
  const pdfId = event.dataTransfer?.getData('application/x-paper-id') || draggedDocId.value
  dropTargetTag.value = null
  draggedDocId.value = null
  if (!pdfId) return

  const doc = realDocuments.value.find(item => item.id === pdfId)
  if (!doc || doc.tags?.includes(tag)) {
    expandTag(tag)
    return
  }

  expandTag(tag)
  addTagMutation.mutate({ pdfId, tag })
}

const renamingDocId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)
const contextMenu = ref<{
  x: number
  y: number
  docId: string
  allowTag: boolean
  allowDelete: boolean
} | null>(null)

function startRename(id: string, currentName: string) {
  closeContextMenu()
  renamingDocId.value = id
  renameValue.value = currentName
  nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

function commitRename() {
  const id = renamingDocId.value
  const title = renameValue.value.trim()
  if (!id || !title) {
    renamingDocId.value = null
    return
  }
  const doc = documents.value?.find(d => d.id === id)
  if (doc && doc.name !== title) {
    renameDocMutation.mutate({ pdfId: id, title })
  }
  renamingDocId.value = null
}

function cancelRename() {
  renamingDocId.value = null
}

function openContextMenu(event: MouseEvent, docId: string, options: { allowTag: boolean; allowDelete: boolean }) {
  if (docId.startsWith('temp-')) return
  event.preventDefault()
  event.stopPropagation()
  contextMenu.value = { x: event.clientX, y: event.clientY, docId, ...options }
}

function closeContextMenu() {
  contextMenu.value = null
}

function renameFromMenu() {
  const menu = contextMenu.value
  if (!menu) return
  const doc = realDocuments.value.find(x => x.id === menu.docId)
  if (!doc) return
  startRename(doc.id, doc.name)
}

function addTagFromMenu() {
  if (!contextMenu.value?.allowTag) return
  const docId = contextMenu.value.docId
  closeContextMenu()
  const tag = window.prompt(t('sidebar.addTagPrompt') || '请输入标签')
  const title = tag?.trim()
  if (!title) return
  addTagMutation.mutate({ pdfId: docId, tag: title })
}

function removeFromMenu() {
  if (!contextMenu.value?.allowDelete) return
  const docId = contextMenu.value.docId
  closeContextMenu()
  removeDocumentById(docId)
}

// 未分类文档：没有标签的文档
const uncategorizedDocs = computed(() => {
  return sortedDocuments.value.filter(doc => !doc.tags || doc.tags.length === 0)
})

function isRecentImportItem(item: RecentListItem): item is Extract<RecentListItem, { type: 'import' }> {
  return item.type === 'import'
}

function isRecentDocumentItem(item: RecentListItem): item is Extract<RecentListItem, { type: 'document' }> {
  return item.type === 'document'
}

function getRecentItemName(item: RecentListItem) {
  if (isRecentDocumentItem(item)) return item.document.name
  return item.task.name || t('sidebar.importingPaper')
}

function getRecentItemStatusText(item: RecentListItem) {
  if (!isRecentImportItem(item)) return ''
  if (item.task.status === 'pending') return t('sidebar.importing')
  return item.task.error || t('sidebar.importFailed')
}

function isRecentItemPending(item: RecentListItem) {
  return isRecentImportItem(item) && item.task.status === 'pending'
}

function isRecentItemFailed(item: RecentListItem) {
  return isRecentImportItem(item) && item.task.status === 'failed'
}

function canRetryRecentItem(item: RecentListItem) {
  return isRecentImportItem(item) && item.task.status === 'failed'
}

function getRecentImportTaskId(item: RecentListItem) {
  return isRecentImportItem(item) ? item.task.id : ''
}

function handleRecentItemClick(item: RecentListItem) {
  if (isRecentDocumentItem(item)) {
    return selectDocument(item.document.id)
  }
}

function handleRecentItemContextMenu(item: RecentListItem, event: MouseEvent) {
  if (isRecentDocumentItem(item)) {
    openContextMenu(event, item.document.id, { allowTag: true, allowDelete: true })
    return
  }

  event.preventDefault()
  event.stopPropagation()
}

// ------------------------- 初始化侧边栏折叠与交互状态 -------------------------
// 控制左侧边栏折叠状态，以及上传文件输入引用
const isCollapsed = useStorage('readme_sidebar_collapsed', true) // 侧边栏是否折叠（默认折叠）
const showUploadModal = ref(false)

// 个性设置：自动隐藏折叠的侧边栏
const autoHideCollapsedSidebar = useStorage('readme_auto_hide_collapsed_sidebar', false)

// 控制侧边栏是否可见（用于自动隐藏功能）
const isSidebarVisible = ref(true)

// 动画状态
const textVisible = ref(!isCollapsed.value)  // 控制文字 opacity（.sidebar-anim-active）
const isCollapsing = ref(false)              // 折叠动画进行中（宽度在收缩但内容仍在 DOM）
let animTimer: ReturnType<typeof setTimeout> | null = null

// 宽度窄态：折叠完成 OR 正在折叠
const widthNarrow = computed(() => (isCollapsed.value || isCollapsing.value) && isSidebarVisible.value)
// 是否显示窄视图（compact 图标模式）：折叠完成且不在动画中
const showNarrowView = computed(() => isCollapsed.value && !isCollapsing.value && isSidebarVisible.value)
// 是否显示完整内容（v-if）：未折叠 OR 正在折叠（保留 DOM 让 overflow-hidden 裁剪）
const showFullContent = computed(() => !isCollapsed.value || isCollapsing.value)

// 鼠标位置检测相关
let mouseMoveHandler: ((e: MouseEvent) => void) | null = null

// 处理鼠标移动事件
function handleMouseMove(e: MouseEvent) {
  if (!autoHideCollapsedSidebar.value || !isCollapsed.value) {
    // 如果功能未开启或未折叠，确保侧边栏可见
    isSidebarVisible.value = true
    return
  }
  
  // 当鼠标在屏幕最左侧 20px 范围内时显示侧边栏
  const TRIGGER_ZONE = 20
  if (e.clientX <= TRIGGER_ZONE) {
    isSidebarVisible.value = true
  }
}

// 处理鼠标离开侧边栏
function handleSidebarMouseLeave() {
  clearHoverExpandTimer()
  if (autoHideCollapsedSidebar.value && isCollapsed.value) {
    isSidebarVisible.value = false
  }
}

// 注册/注销鼠标移动监听
onMounted(() => {
  mouseMoveHandler = handleMouseMove
  document.addEventListener('mousemove', mouseMoveHandler)
  document.addEventListener('click', closeContextMenu)
})

onUnmounted(() => {
  if (mouseMoveHandler) {
    document.removeEventListener('mousemove', mouseMoveHandler)
  }
  document.removeEventListener('click', closeContextMenu)
  clearHoverExpandTimer()
  if (animTimer) { clearTimeout(animTimer); animTimer = null }
})

// ------------------------- 左侧边栏折叠控制 -------------------------
// 折叠：宽度立刻收缩 + overflow-hidden 从右往左"吞掉"文字 + 同步淡出
// 展开：宽度伸展 → 文字淡入
function toggleSidebar() {
  if (animTimer) { clearTimeout(animTimer); animTimer = null }

  if (isCollapsed.value) {
    // 展开：打开 DOM → 等渲染初始态 → 文字淡入
    isCollapsed.value = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { textVisible.value = true })
    })
  } else {
    // 折叠：宽度立刻收缩 + 文字同步淡出，300ms 后（宽度过渡结束）切换到 compact
    isCollapsing.value = true
    textVisible.value = false
    animTimer = setTimeout(() => {
      isCollapsed.value = true
      isCollapsing.value = false
    }, 300) // 匹配 duration-300
  }
}



// ------------------------- 文件上传流程 -------------------------
// 触发文件上传（打开弹框）
function triggerFileUpload() {
  showUploadModal.value = true
}

function shouldStartProcessingStream(response: { pdfId?: string; taskId?: string | null; status?: string | null }) {
  if (!response.pdfId) return false
  return Boolean(response.taskId) || response.status === 'pending' || response.status === 'processing'
}

async function openImportedDocument(docId: string, options?: { localFile?: File }) {
  if (options?.localFile) {
    const localBlobUrl = URL.createObjectURL(options.localFile)
    libraryStore.blobUrlCache.set(docId, localBlobUrl)
  }

  await libraryStore.selectDocument(docId)
  isCollapsed.value = true
}

async function uploadFileAndOpen(file: File, recentTaskId?: string) {
  const response = await uploadMutation.mutateAsync(
    recentTaskId ? { file, recentTaskId } : { file },
  )
  const docId = response.pdfId
  if (!docId) throw new Error('No PDF ID returned')
  if (shouldStartProcessingStream(response)) {
    libraryStore.setProcessingStreamPdfId(docId)
  }
  await openImportedDocument(docId, { localFile: file })
}

async function importLinkAndOpen(input: string, recentTaskId?: string) {
  await startImportLink(input, {
    recentTaskId,
    onReady: async (event) => {
      if (shouldStartProcessingStream(event)) {
        libraryStore.setProcessingStreamPdfId(event.pdfId)
      }
      await openImportedDocument(event.pdfId)
    },
  })
}

// 处理文件上传（接受 File 对象）
async function handleFileUpload(file: File) {
  if (!file || file.type !== 'application/pdf') return

  showUploadModal.value = false
  // 埋点：开始导入（文件上传）
  trackEvent('paper_import_started', { import_type: 'file', file_size: file.size })

  try {
    chatStore.resetForNewDocument()
    roadmapStore.resetForNewDocument()

    await uploadFileAndOpen(file)
  } catch (error) {
    // paper_import_succeeded / failed 已迁移至后端埋点
    console.error(t('sidebar.uploadFailed'), error)
  }
}

// 从弹框导入链接
async function handleModalImportLink(url: string) {
  showUploadModal.value = false
  importLinkValue.value = url
  await handleImportLink()
}

// ------------------------- 链接导入流程 -------------------------
const importLinkValue = ref('')

async function handleImportLink() {
  const input = importLinkValue.value.trim()
  if (!input) return

  // 埋点：开始导入（链接）
  trackEvent('paper_import_started', { import_type: 'link' })

  try {
    chatStore.resetForNewDocument()
    roadmapStore.resetForNewDocument()

    await importLinkAndOpen(input)
    importLinkValue.value = ''
  } catch (error) {
    // paper_import_succeeded / failed 已迁移至后端埋点
    console.error(t('sidebar.importFailed'), error)
  }
}

async function retryRecentImport(taskId: string, event: Event) {
  event.stopPropagation()

  const retryPayload = libraryStore.prepareRecentImportRetry(taskId)
  if (!retryPayload) return

  try {
    chatStore.resetForNewDocument()
    roadmapStore.resetForNewDocument()

    if (retryPayload.kind === 'file') {
      trackEvent('paper_import_started', { import_type: 'file', file_size: retryPayload.file.size })
      await uploadFileAndOpen(retryPayload.file, taskId)
      return
    }

    trackEvent('paper_import_started', { import_type: 'link' })
    await importLinkAndOpen(retryPayload.input, taskId)
  } catch (error) {
    console.error('[Sidebar] Failed to retry import:', error)
  }
}

// ------------------------- 文档选择与删除 -------------------------
// 选择文档
async function selectDocument(id: string) {
  if (id.startsWith('temp-')) return
  // 如果点击的是当前已选中的文献，且已有 URL，仍需刷新最近阅读时间
  if (libraryStore.currentDocumentId === id && pdfStore.currentPdfUrl) {
    libraryStore.lastReadMap[id] = Date.now()
    isCollapsed.value = true
    return
  }

  // 从 Vue Query 缓存中查找
  const doc = realDocuments.value.find(d => d.id === id)
  if (doc) {
    const previousDocId = libraryStore.currentDocumentId
    chatStore.resetForNewDocument()
    roadmapStore.resetForNewDocument()

    try {
      await libraryStore.selectDocument(id)
      isCollapsed.value = true
    } catch (err) {
      console.error('[Sidebar] Failed to switch document:', err)
      // 回滚 currentDocumentId，防止侧边栏高亮与阅读器不一致
      libraryStore.currentDocumentId = previousDocId
    }
  }
}

// 删除文档
function removeDocument(id: string, event: Event) {
  event.stopPropagation()
  removeDocumentById(id)
}

function removeDocumentById(id: string) {
  if (confirm(t('sidebar.confirmDelete'))) {
    if (libraryStore.currentDocumentId === id) {
      pdfStore.setCurrentPdf('', undefined)
      libraryStore.currentDocumentId = null
      chatStore.resetForNewDocument()
      roadmapStore.resetForNewDocument()
    }
    pdfStore.removeDocumentHighlights(id)
    deleteDocMutation.mutate(id)
  }
}

// ------------------------- 组件脚本结束 -------------------------
// ---------------------------------------------------------------


// ------------------------- 组件模板开始 -------------------------
// （以下内容可以在 F12 开发者工具中查看）
</script>

<template>
  <div class="h-full flex-shrink-0 relative">
    <!-- 自动隐藏模式下的触发条 - 始终在最左侧 -->
    <div
      v-if="autoHideCollapsedSidebar && isCollapsed && !isSidebarVisible"
      class="sidebar-trigger-zone fixed left-0 top-0 bottom-0 w-2 z-50"
      @mouseenter="isSidebarVisible = true"
    />
    
    <!-- 侧边栏主体 - 根据设置决定是否自动隐藏 -->
    <aside
      v-show="!isCollapsed || isSidebarVisible"
      :class="[
        'h-full sidebar-shell flex flex-col transition-all duration-300 overflow-hidden',
        widthNarrow ? 'w-16' : 'w-60',
        textVisible ? 'sidebar-anim-active' : '',
        autoHideCollapsedSidebar && isCollapsed && isSidebarVisible ? 'sidebar-auto-show' : ''
      ]"
      @mouseleave="handleSidebarMouseLeave"
    >
      <!-- Logo Area -->
      <div class="h-[42px] flex items-center justify-between px-4 pt-1">
        <h1 v-if="showFullContent" class="logo-text cursor-pointer sidebar-fade" @click="router.push('/')">
          <span class="logo-bracket">&lt;/</span><span class="logo-read">READ</span><span class="logo-me">ME</span><span class="logo-bracket">&gt;</span>
        </h1>
        <button
          @click="toggleSidebar"
          class="p-2.5 rounded-lg transition-colors sidebar-icon-btn interactive-3d"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              :d="isCollapsed ? 'M13 5l7 7-7 7M5 5l7 7-7 7' : 'M11 19l-7-7 7-7M19 19l-7-7 7-7'"
            />
          </svg>
        </button>
      </div>

      <!-- Upload Modal -->
      <UploadModal
        v-if="showUploadModal"
        @close="showUploadModal = false"
        @file="handleFileUpload"
        @link="handleModalImportLink"
      />

      <!-- Upload Button -->
      <div :class="showNarrowView ? 'p-4 flex justify-center' : 'p-4'">
        <button
          @click="triggerFileUpload"
          :class="[
            'sidebar-upload-btn interactive-3d flex items-center rounded-lg transition-colors whitespace-nowrap',
            showNarrowView ? 'sidebar-action-btn-compact justify-center' : 'w-full justify-center gap-2 px-4 py-2.5'
          ]"
          :title="t('sidebar.uploadPdf')"
        >
          <svg class="sidebar-action-icon flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <span v-if="showFullContent" class="sidebar-fade">{{ t('sidebar.uploadPdf') }}</span>
        </button>

      </div>

      <!-- Library Management Button -->
      <div :class="showNarrowView ? 'p-4 pt-0 flex justify-center' : 'p-4 pt-0'">
        <button
          @click="router.push('/library')"
          :class="[
            'sidebar-library-btn interactive-3d flex items-center rounded-lg transition-colors whitespace-nowrap',
            showNarrowView ? 'sidebar-action-btn-compact justify-center' : 'w-full justify-center gap-2 px-4 py-2.5'
          ]"
          :title="t('sidebar.libraryManagement')"
        >
          <!-- 书籍图标 -->
          <svg class="sidebar-action-icon flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span v-if="showFullContent" class="sidebar-fade">{{ t('sidebar.libraryManagement') }}</span>
        </button>
      </div>

      <!-- Document List -->
      <div class="flex-1 overflow-y-auto px-2 mt-2 space-y-4 sidebar-fade">

        <!-- 最近阅读 -->
        <div v-if="showFullContent && recentItems.length > 0">
          <div class="sidebar-recent-list" :class="{ 'sidebar-recent-list--scroll': recentItems.length > 4 }">
            <div
              v-for="item in recentItems"
              :key="item.id"
              @click="handleRecentItemClick(item)"
              @contextmenu="handleRecentItemContextMenu(item, $event)"
              :class="[
                'flex items-start gap-2 px-2 py-1.5 rounded-lg transition-all sidebar-item sidebar-recent-item group',
                isRecentItemPending(item) ? 'opacity-70 cursor-wait' : '',
                isRecentItemFailed(item) ? 'sidebar-recent-item--failed' : '',
                isRecentDocumentItem(item) ? 'cursor-pointer' : 'cursor-default',
                isRecentDocumentItem(item) && libraryStore.currentDocumentId === item.document.id ? 'sidebar-item--active' : ''
              ]"
            >
              <svg
                class="w-4 h-4 flex-shrink-0 mt-0.5 opacity-60"
                :class="{ 'text-red-500 opacity-100': isRecentItemFailed(item) }"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <input
                v-if="isRecentDocumentItem(item) && renamingDocId === item.document.id"
                ref="renameInputRef"
                v-model="renameValue"
                class="sidebar-rename-input flex-1 text-xs"
                @click.stop
                @keydown.enter.prevent="commitRename"
                @keydown.esc.prevent="cancelRename"
                @blur="commitRename"
              />
              <div v-else class="min-w-0 flex-1">
                <div class="truncate text-xs">
                  {{ getRecentItemName(item) }}
                </div>
                <div
                  v-if="isRecentImportItem(item)"
                  class="mt-0.5 text-[11px] leading-4"
                  :class="isRecentItemFailed(item) ? 'sidebar-recent-meta--error' : 'sidebar-recent-meta--muted'"
                >
                  {{ getRecentItemStatusText(item) }}
                </div>
              </div>
              <button
                v-if="canRetryRecentItem(item)"
                type="button"
                class="sidebar-retry-btn"
                @click="retryRecentImport(getRecentImportTaskId(item), $event)"
              >
                {{ t('sidebar.retry') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 标签分组 (可展开的文件管理器式) -->
        <div v-if="showFullContent && (uniqueTags.length > 0 || uncategorizedDocs.length > 0)">
           <div class="px-2 py-2 text-xs uppercase tracking-wider sidebar-section-title">
            {{ t('sidebar.tagGroups') }}
          </div>
          <ul class="space-y-0.5 text-sm">
            <!-- 有标签的文档分组 -->
            <li v-for="tag in uniqueTags" :key="tag">
              <!-- 标签行: 展开箭头 + 彩色tag图标 + 标签名 + 跳转 -->
              <div
                :class="[
                  'flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-colors sidebar-tag-item group',
                  dropTargetTag === tag ? 'sidebar-tag-item--drop-target' : '',
                ]"
                @mouseenter="scheduleHoverExpand(tag)"
                @mouseleave="clearHoverExpandTimer(tag)"
                @dragover="handleTagDragOver($event, tag)"
                @dragleave="handleTagDragLeave($event, tag)"
                @drop="handleTagDrop($event, tag)"
              >
                <button
                  @click.stop="toggleTagExpand(tag)"
                  class="sidebar-tag-chevron"
                  :class="{ 'sidebar-tag-chevron--open': expandedTags.has(tag) }"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
                <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" :style="{ color: getTagColor(tag) }">
                  <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span class="flex-1 truncate" @click="toggleTagExpand(tag)">{{ tag }}</span>
                <button
                  @click.stop="router.push(`/library?tag=${encodeURIComponent(tag)}`)"
                  class="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all sidebar-tag-goto"
                  title="查看标签详情"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </button>
              </div>
              <!-- 展开的论文列表 -->
              <ul v-if="expandedTags.has(tag)" class="sidebar-tag-children">
                <li
                  v-for="doc in docsForTag(tag)"
                  :key="doc.id"
                  :draggable="!doc.id.startsWith('temp-')"
                  @click="selectDocument(doc.id)"
                  @dragstart="handleDocumentDragStart($event, doc)"
                  @dragend="handleDocumentDragEnd"
                  @contextmenu="openContextMenu($event, doc.id, { allowTag: true, allowDelete: true })"
                  :class="[
                    'flex items-center gap-2 pl-8 pr-2 py-1 rounded-md transition-all sidebar-item sidebar-tag-child',
                    doc.id.startsWith('temp-') ? 'opacity-50 cursor-wait' : 'cursor-pointer',
                    draggedDocId === doc.id ? 'sidebar-tag-child--dragging' : '',
                    libraryStore.currentDocumentId === doc.id ? 'sidebar-item--active' : ''
                  ]"
                >
                  <svg class="w-4 h-4 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <input
                    v-if="renamingDocId === doc.id"
                    ref="renameInputRef"
                    v-model="renameValue"
                    class="sidebar-rename-input flex-1 text-xs"
                    @click.stop
                    @keydown.enter.prevent="commitRename"
                    @keydown.esc.prevent="cancelRename"
                    @blur="commitRename"
                  />
                  <span v-else class="flex-1 truncate text-xs">{{ doc.id.startsWith('temp-') ? (doc.name && doc.name !== 'Importing paper' ? t('sidebar.importingNamed', { name: doc.name }) : t('sidebar.importingPaper')) : doc.name }}</span>
                </li>
                <li v-if="docsForTag(tag).length === 0" class="pl-8 py-1 text-xs sidebar-empty">无文献</li>
              </ul>
            </li>

            <!-- 未分类文档分组 -->
            <li v-if="uncategorizedDocs.length > 0">
              <!-- 标签行: 展开箭头 + 彩色tag图标 + 标签名 -->
              <div
                class="flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-colors sidebar-tag-item group"
                @mouseenter="scheduleHoverExpand('__uncategorized__')"
                @mouseleave="clearHoverExpandTimer('__uncategorized__')"
              >
                <button
                  @click.stop="toggleTagExpand('__uncategorized__')"
                  class="sidebar-tag-chevron"
                  :class="{ 'sidebar-tag-chevron--open': expandedTags.has('__uncategorized__') }"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
                <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" :style="{ color: getTagColor(t('sidebar.uncategorized')) }">
                  <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span class="flex-1 truncate" @click="toggleTagExpand('__uncategorized__')">{{ t('sidebar.uncategorized') }}</span>
              </div>
              <!-- 展开的论文列表 -->
              <ul v-if="expandedTags.has('__uncategorized__')" class="sidebar-tag-children">
                <li
                  v-for="doc in uncategorizedDocs"
                  :key="doc.id"
                  :draggable="!doc.id.startsWith('temp-')"
                  @click="selectDocument(doc.id)"
                  @dragstart="handleDocumentDragStart($event, doc)"
                  @dragend="handleDocumentDragEnd"
                  @contextmenu="openContextMenu($event, doc.id, { allowTag: true, allowDelete: true })"
                  :class="[
                    'flex items-center gap-2 pl-8 pr-2 py-1 rounded-md transition-all sidebar-item sidebar-tag-child',
                    doc.id.startsWith('temp-') ? 'opacity-50 cursor-wait' : 'cursor-pointer',
                    draggedDocId === doc.id ? 'sidebar-tag-child--dragging' : '',
                    libraryStore.currentDocumentId === doc.id ? 'sidebar-item--active' : ''
                  ]"
                >
                  <svg class="w-4 h-4 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <input
                    v-if="renamingDocId === doc.id"
                    ref="renameInputRef"
                    v-model="renameValue"
                    class="sidebar-rename-input flex-1 text-xs"
                    @click.stop
                    @keydown.enter.prevent="commitRename"
                    @keydown.esc.prevent="cancelRename"
                    @blur="commitRename"
                  />
                  <span v-else class="flex-1 truncate text-xs">{{ doc.id.startsWith('temp-') ? (doc.name && doc.name !== 'Importing paper' ? t('sidebar.importingNamed', { name: doc.name }) : t('sidebar.importingPaper')) : doc.name }}</span>
                  <button
                    @click="removeDocument(doc.id, $event)"
                    class="opacity-0 group-hover:opacity-100 p-1 rounded transition-all sidebar-delete-btn flex-shrink-0"
                  >
                    <svg class="w-3 h-3 sidebar-delete-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </div>

        <!-- Empty State -->
        <div
          v-if="showFullContent && realDocuments.length === 0 && recentItems.length === 0"
          class="text-center py-8 px-4 sidebar-empty"
        >
          <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p class="text-sm">{{ t('sidebar.noPapers') }}</p>
          <p class="text-xs mt-1">{{ t('sidebar.clickToUpload') }}</p>
        </div>
      </div>

      <Teleport to="body">
        <div
          v-if="contextMenu"
          class="sidebar-context-menu"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
          @click.stop
        >
          <button class="sidebar-context-item" @click="renameFromMenu">{{ t('sidebar.renamePaper') }}</button>
          <button v-if="contextMenu.allowTag" class="sidebar-context-item" @click="addTagFromMenu">{{ t('sidebar.tagPaper') }}</button>
          <button v-if="contextMenu.allowDelete" class="sidebar-context-item sidebar-context-item--danger" @click="removeFromMenu">{{ t('sidebar.deletePaper') }}</button>
        </div>
      </Teleport>

      <!-- Theme Toggle Button (Above User Info) -->
      <div :class="showNarrowView ? 'px-2 pb-3 flex justify-center' : 'px-4 pb-3'">
        <button
          @click="themeStore.toggleTheme"
          :class="[
            'sidebar-theme-btn interactive-3d flex items-center justify-center rounded-lg transition-colors whitespace-nowrap',
            showNarrowView ? 'sidebar-action-btn-compact justify-center' : 'w-full gap-2 px-4 py-3'
          ]"
          :title="themeStore.isDarkMode ? t('sidebar.switchToLight') : t('sidebar.switchToDark')"
        >
          <svg v-if="themeStore.isDarkMode" class="sidebar-action-icon flex-shrink-0 sidebar-theme-icon--sun" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <svg v-else class="sidebar-action-icon flex-shrink-0 sidebar-theme-icon--moon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
          <span v-if="showFullContent" class="text-sm font-medium sidebar-fade">
            {{ themeStore.isDarkMode ? t('sidebar.lightMode') : t('sidebar.darkMode') }}
          </span>
        </button>
      </div>

      <!-- User Info (Bottom) -->
      <div :class="showNarrowView ? 'p-2 sidebar-user' : 'p-4 sidebar-user'">
        <div :class="showNarrowView ? 'flex items-center justify-center' : 'flex items-center gap-3'">
          <div class="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-all sidebar-user-avatar flex-shrink-0" @click="router.push('/profile')" :title="t('sidebar.profile')">
            <span class="text-sm font-medium">{{ authStore.user?.username?.charAt(0)?.toUpperCase() || 'U' }}</span>
          </div>
          <div v-if="showFullContent" class="flex-1 min-w-0 cursor-pointer sidebar-fade" @click="router.push('/profile')">
            <p class="text-sm font-medium truncate transition-colors sidebar-user-name">{{ authStore.user?.username || t('sidebar.user') }}</p>
          </div>
        </div>
      </div>
    </aside>


  </div>
</template>

<style scoped>
.sidebar-recent-list--scroll {
  max-height: 148px;
  overflow-y: auto;
}
.sidebar-recent-list--scroll::-webkit-scrollbar {
  width: 3px;
}
.sidebar-recent-list--scroll::-webkit-scrollbar-thumb {
  background: var(--c-sidebar-text-muted, rgba(156, 163, 175, 0.3));
  border-radius: 2px;
  opacity: 0.4;
}
.sidebar-recent-item:hover svg {
  opacity: 1;
}
.sidebar-recent-item--failed {
  border-color: rgba(239, 68, 68, 0.18);
  background: rgba(239, 68, 68, 0.05);
}
.sidebar-recent-meta--muted {
  color: var(--c-sidebar-text-subtle);
}
.sidebar-recent-meta--error {
  color: var(--c-sidebar-danger);
}
.sidebar-retry-btn {
  flex-shrink: 0;
  align-self: center;
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.08);
  color: var(--c-sidebar-danger);
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.4;
  transition: background-color var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default);
}
.sidebar-retry-btn:hover {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.4);
}
.logo-text {
  font-family: var(--font-logo);
  font-size: 1.34rem;
  font-weight: var(--font-bold);
  letter-spacing: -0.02em;
}

.sidebar-edge-trigger:hover { background: var(--c-sidebar-bg-hover); }
.sidebar-shell {
  background: var(--c-sidebar-bg);
  background-image: linear-gradient(180deg, var(--c-sidebar-bg-start), var(--c-sidebar-bg-end));
  color: var(--c-sidebar-text);
  border-right: var(--border-width) solid var(--c-sidebar-border);
  box-shadow: 10px 0 24px -22px var(--c-sidebar-surface-glow);
}

.sidebar-icon-btn {
  color: var(--c-sidebar-text-muted);
  min-width: 36px;
  min-height: 36px;
}
.sidebar-icon-btn:hover { background: var(--c-sidebar-bg-hover); color: var(--c-sidebar-text); }

.sidebar-upload-btn {
  min-height: 38px;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  background: var(--c-accent-bg);
  color: var(--c-accent);
  border: var(--border-width) solid var(--c-accent-border);
  box-shadow: var(--interactive-shadow-rest);
}
.sidebar-upload-btn:hover {
  background: var(--c-btn-icon-active-bg);
  border-color: var(--c-btn-icon-active-border);
  color: var(--c-btn-icon-active-text);
}

.sidebar-import-btn {
  min-height: 38px;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  background: var(--c-accent-bg);
  color: var(--c-accent);
  border: var(--border-width) solid var(--c-accent-border);
  box-shadow: var(--interactive-shadow-rest);
}
.sidebar-import-btn:hover {
  background: var(--c-btn-icon-active-bg);
  border-color: var(--c-btn-icon-active-border);
  color: var(--c-btn-icon-active-text);
}
.sidebar-import-btn.sidebar-action-btn-compact {
  background: transparent;
  color: var(--c-sidebar-text-muted);
  border-color: transparent;
  box-shadow: none;
}
.sidebar-import-btn.sidebar-action-btn-compact:hover {
  background: var(--c-sidebar-bg-hover);
  border-color: var(--c-sidebar-border);
  color: var(--c-sidebar-text);
  box-shadow: var(--interactive-shadow-hover);
}

.sidebar-import-input {
  background: var(--c-bg-input);
  color: var(--c-text-primary);
  border: var(--border-width) solid var(--c-border-input);
  outline: none;
}
.sidebar-import-input:focus {
  border-color: var(--c-border-focus);
  box-shadow: var(--ring-focus);
}
.sidebar-import-input::placeholder {
  color: var(--c-text-placeholder);
}

.sidebar-import-ok-btn {
  background: var(--c-accent-bg);
  color: var(--c-accent);
  border: var(--border-width) solid var(--c-accent-border);
  font-weight: var(--font-semibold);
  cursor: pointer;
}
.sidebar-import-ok-btn:hover {
  background: var(--c-btn-icon-active-bg);
  border-color: var(--c-btn-icon-active-border);
  color: var(--c-btn-icon-active-text);
}
.sidebar-import-ok-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sidebar-import-cancel-btn {
  background: transparent;
  color: var(--c-text-muted);
  border: none;
  cursor: pointer;
}
.sidebar-import-cancel-btn:hover {
  color: var(--c-text-primary);
  background: var(--c-sidebar-bg-hover);
}

.sidebar-library-btn {
  min-height: 38px;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  background: var(--c-accent-bg);
  color: var(--c-accent);
  border: var(--border-width) solid var(--c-accent-border);
  box-shadow: var(--interactive-shadow-rest);
}
.sidebar-library-btn:hover {
  background: var(--c-btn-icon-active-bg);
  border-color: var(--c-btn-icon-active-border);
  color: var(--c-btn-icon-active-text);
}

.sidebar-library-btn.sidebar-action-btn-compact {
  background: transparent;
  color: var(--c-sidebar-text-muted);
  border-color: transparent;
  box-shadow: none;
}

.sidebar-library-btn.sidebar-action-btn-compact:hover {
  background: var(--c-sidebar-bg-hover);
  border-color: var(--c-sidebar-border);
  color: var(--c-sidebar-text);
  box-shadow: var(--interactive-shadow-hover);
}

.sidebar-action-btn-compact {
  width: 40px;
  min-width: 40px;
  height: 40px;
  min-height: 40px;
  padding: 0;
  gap: 0;
}

.sidebar-action-icon {
  width: var(--btn-icon-size);
  height: var(--btn-icon-size);
}

.sidebar-upload-btn.sidebar-action-btn-compact {
  background: transparent;
  color: var(--c-sidebar-text-muted);
  border-color: transparent;
  box-shadow: none;
}

.sidebar-upload-btn.sidebar-action-btn-compact:hover {
  background: var(--c-sidebar-bg-hover);
  border-color: var(--c-sidebar-border);
  color: var(--c-sidebar-text);
  box-shadow: var(--interactive-shadow-hover);
}

.sidebar-section-link,
.sidebar-section-title { color: var(--c-sidebar-text-subtle); }
.sidebar-section-link { font-weight: var(--font-semibold); }
.sidebar-section-link:hover { color: var(--c-sidebar-text); }

.sidebar-item {
  color: var(--c-sidebar-text-muted);
  border: var(--border-width) solid transparent;
  background: transparent;
}
.sidebar-item:hover { background: var(--c-sidebar-bg-hover); color: var(--c-sidebar-text); }
.sidebar-item--active {
  color: var(--c-sidebar-text);
  border-color: transparent;
  box-shadow: inset 2px 0 0 var(--c-accent-light);
}

.sidebar-item--active:hover {
  background: var(--c-sidebar-bg-hover);
}

.sidebar-delete-btn:hover { background: var(--c-sidebar-danger-bg); }
.sidebar-delete-icon { color: var(--c-sidebar-danger); }

.sidebar-rename-input {
  min-width: 0;
  border: 1px solid var(--c-border-input);
  border-radius: 6px;
  background: var(--c-bg-input);
  color: var(--c-text-primary);
  padding: 2px 6px;
  outline: none;
}

.sidebar-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 140px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background: var(--c-bg-primary);
  box-shadow: var(--shadow-lg);
  padding: 4px;
}

.sidebar-context-item {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--c-text-secondary);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 12px;
}
.sidebar-context-item:hover {
  background: var(--c-sidebar-bg-hover);
  color: var(--c-text-primary);
}
.sidebar-context-item--danger {
  color: var(--c-sidebar-danger);
}

.sidebar-tag-item { color: var(--c-sidebar-text-muted); }
.sidebar-tag-item:hover { background: var(--c-sidebar-bg-hover); color: var(--c-sidebar-text); }
.sidebar-tag-item--drop-target {
  color: var(--c-sidebar-text);
  background: var(--c-sidebar-bg-hover);
  box-shadow: inset 0 0 0 1px var(--c-accent-light);
}
.sidebar-tag-icon { color: var(--c-accent-light); }

.sidebar-tag-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--c-sidebar-text-subtle);
  transition: transform var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default);
}
.sidebar-tag-chevron--open { transform: rotate(90deg); }
.sidebar-tag-item:hover .sidebar-tag-chevron { color: var(--c-sidebar-text); }

.sidebar-tag-goto {
  color: var(--c-sidebar-text-subtle);
}
.sidebar-tag-goto:hover {
  color: var(--c-accent-light);
  background: var(--c-sidebar-bg-hover);
}

.sidebar-tag-badge {
  display: inline-block;
  font-size: 9px;
  line-height: 1;
  padding: 1px 5px;
  border-radius: var(--radius-full);
  border: 1px solid;
  white-space: nowrap;
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: var(--font-medium);
}

.sidebar-tag-children {
  margin-top: 2px;
  margin-bottom: 4px;
}
.sidebar-tag-child {
  font-size: var(--text-xs);
}
.sidebar-tag-child--dragging {
  opacity: 0.45;
}

.sidebar-empty { color: var(--c-sidebar-text-subtle); }

.sidebar-theme-btn {
  min-height: 42px;
  background: var(--c-sidebar-bg-hover);
  border: var(--border-width) solid var(--c-sidebar-border);
  color: var(--c-sidebar-text);
}
.sidebar-theme-btn:hover { background: var(--c-sidebar-bg-active); }

.sidebar-theme-btn.sidebar-action-btn-compact {
  background: transparent;
  color: var(--c-sidebar-text-muted);
  border-color: transparent;
  box-shadow: none;
}

.sidebar-theme-btn.sidebar-action-btn-compact:hover {
  background: var(--c-sidebar-bg-hover);
  border-color: var(--c-sidebar-border);
  color: var(--c-sidebar-text);
  box-shadow: var(--interactive-shadow-hover);
}

.sidebar-theme-icon--sun { color: var(--c-sidebar-theme-sun); }
.sidebar-theme-icon--moon { color: var(--c-sidebar-theme-moon); }

.sidebar-user { border-top: var(--border-width) solid var(--c-sidebar-border); }
.sidebar-user-avatar {
  background: linear-gradient(135deg, var(--c-accent-gradient-start), var(--c-accent-gradient-end));
  color: var(--c-text-on-accent);
  border: var(--border-width) solid var(--c-accent-gradient-border);
  box-shadow:
    0 1px 0 var(--c-accent-sheen) inset,
    var(--interactive-shadow-rest);
}
.sidebar-user-avatar:hover { box-shadow: 0 0 0 2px var(--c-accent-light); }
.sidebar-user-name:hover { color: var(--c-accent-light); }

.logo-bracket { color: var(--c-logo-bracket); font-weight: var(--font-normal); }
.logo-read { color: var(--c-logo-read); }
.logo-me { color: var(--c-logo-me); }

/* 自动显示侧边栏时的动画效果 */
.sidebar-auto-show {
  animation: sidebarSlideIn 0.2s ease-out;
}

@keyframes sidebarSlideIn {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

/* 触发区域样式 */
.sidebar-trigger-zone {
  background: transparent;
  cursor: pointer;
}

.sidebar-trigger-zone:hover {
  background: linear-gradient(90deg, rgba(var(--c-accent-rgb, 59, 130, 246), 0.1), transparent);
}

/* ============ 展开/折叠动画 ============
 *  折叠：宽度立刻收缩，overflow-hidden 从右往左"吞掉"内容，
 *        文字同步淡出，300ms 结束时 opacity 刚好归零。
 *  展开：宽度伸展，文字淡入。
 */
.sidebar-fade {
  opacity: 0;
  /* 折叠（回到 base 态）：淡出 180ms，延迟 80ms（留出初始裁剪阶段），
     80 + 180 = 260ms ≈ 300ms 宽度结束时字刚好消失 */
  transition: opacity 180ms ease;
  transition-delay: 80ms;
}
.sidebar-anim-active .sidebar-fade {
  opacity: 1;
  /* 展开（进入 active 态）：淡入 120ms，延迟 80ms（等宽度展开一点再显示） */
  transition: opacity 120ms ease;
  transition-delay: 80ms;
}
</style>
