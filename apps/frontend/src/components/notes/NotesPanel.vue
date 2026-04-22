<script setup lang="ts">
/**
 * NotesPanel.vue
 * 说明：该文件实现笔记列表（卡片式）的显示、编辑、创建与删除逻辑。
 * - 支持在当前打开的文档（PDF）下加载并展示笔记
 * - 支持本地临时笔记（未保存）与数据库中持久笔记的混合管理
 * - 编辑时可使用富文本/渲染模式（NoteEditor）或源码（Raw Markdown）模式
 */

// ------------------------- 导入与初始化 -------------------------
// 使用 Vue 的 Composition API
import { ref, watch, nextTick, computed } from 'vue'
// 引入应用级的 store，用于获取当前文档（pdf）信息
import { useLibraryStore } from '../../stores/library'
import { useNotesUiStore } from '../../stores/notes-ui'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'
// 与后端交互的笔记类型定义
import type { Note } from '../../api'
// 引入标准 Query Hooks
import { 
  useNotesQuery, 
  useCreateNoteMutation, 
  useUpdateNoteMutation, 
  useDeleteNoteMutation 
} from '../../composables/queries/useNoteQueries'
// 内部使用的编辑器组件（基于 Tiptap）
import NoteEditor from './NoteEditor.vue'
import { trackEvent } from '../../utils/tracking'

// ------------------------- 数据类型定义（TypeScript） -------------------------
/**
 * NoteCard
 * - 用于在 UI 中表示一条笔记卡片的数据结构
 * - id 可以是数据库自增 ID（number）或本地临时 ID（string）
 */
interface NoteCard {
  id: string | number  // 本地临时ID（string，如 temp-...）或数据库ID（number）
  title: string        // 笔记标题
  content: string      // 笔记正文（Markdown）
  tags: string[]       // 笔记标签列表
  isEditing: boolean   // 是否处于编辑模式
  isCollapsed: boolean // 在已完成（非编辑）状态下是否折叠显示只读预览
  showRawMd?: boolean  // 编辑模式下是否显示原始 Markdown 文本编辑器
  createdAt: number    // 创建时间的时间戳（用于 UI 排序或展示）
  isLocal?: boolean    // 是否为本地临时笔记（尚未保存到后端）
  source?: 'remote' | 'local'  // 笔记来源：remote 表示从后端加载，local 表示本地创建
}

// ------------------------- 响应式状态 -------------------------
const libraryStore = useLibraryStore()        // 读取当前文档 id 等信息
const notesUiStore = useNotesUiStore()
const { renderMarkdown } = useMarkdownRenderer()
const localCards = ref<NoteCard[]>([])        // 仅存储本地临时（未保存）或正在编辑的状态
const containerRef = ref<HTMLElement | null>(null) // 卡片列表容器的 DOM 引用（用于滚动）

// 使用标准 Query 加载数据
const { data: remoteNotes, isLoading: isInitialLoading } = useNotesQuery(() => libraryStore.currentDocumentId)
const createMutation = useCreateNoteMutation()
const updateMutation = useUpdateNoteMutation()
const deleteMutation = useDeleteNoteMutation()

// 状态追踪：哪些笔记正在被编辑，或者被折叠/展开（维护 UI 状态）
const cardStates = ref<Record<string | number, Partial<NoteCard>>>({})

/**
 * 核心逻辑：合并远程数据与本地 UI 状态
 * 1. 从 remoteNotes 映射出基础卡片
 * 2. 叠加上本地的 isEditing, isCollapsed 等 UI 状态
 * 3. 追加本地尚未保存的临时卡片
 */
const cards = computed<NoteCard[]>(() => {
  const remoteMapped = (remoteNotes.value || []).map((note: Note) => {
    const state = cardStates.value[note.id] || {}
    return {
      id: note.id,
      title: note.title || '',
      content: note.content || '',
      tags: note.tags || [],
      isEditing: state.isEditing ?? false,
      isCollapsed: state.isCollapsed ?? true,
      showRawMd: state.showRawMd ?? false,
      createdAt: new Date(note.createdAt).getTime(),
      isLocal: false
    }
  })

  return [...remoteMapped, ...localCards.value]
})

// 加载状态：如果是初次加载且没有缓存，则显示 Loading
const isLoading = computed(() => isInitialLoading.value && (!remoteNotes.value || remoteNotes.value.length === 0))

// ------------------------- 工具函数 -------------------------
/**
 * 生成临时 ID
 * 用于本地新建的笔记，在保存到后端前用字符串 ID 占位
 */
function generateTempId() {
  return `temp-${Date.now()}-${Math.random().toString(36).substring(2)}`
}

// ------------------------- 监听：文档切换时重置本地状态 -------------------------
watch(() => libraryStore.currentDocumentId, () => {
  localCards.value = []
  cardStates.value = {}
}, { immediate: true })

// ------------------------- 监听：外部请求新建笔记（高亮选区、AI 问答等） -------------------------
watch(() => notesUiStore.pendingNote, (pending) => {
  if (!pending) return
  const id = generateTempId()
  const newCard: NoteCard = {
    id,
    title: pending.title || '',
    content: pending.content || '',
    tags: pending.tags || [],
    isEditing: true,
    isCollapsed: false,
    showRawMd: false,
    createdAt: Date.now(),
    isLocal: true
  }
  localCards.value.push(newCard)
  notesUiStore.clearPendingNote()
  nextTick(() => {
    containerRef.value?.scrollTo({ top: containerRef.value.scrollHeight, behavior: 'smooth' })
  })
})

// ------------------------- 保存到后端 -------------------------
/**
 * 保存笔记到数据库（乐观更新，不阻塞 UI）
 * - 如果 card.isLocal 为 true：创建笔记
 * - 否则（存在数据库 id 的情况）进行更新
 * - 使用乐观更新策略，立即更新 UI，后台异步保存
 */
function saveNoteToDB(card: NoteCard) {
  if (!libraryStore.currentDocumentId) return

  if (card.isLocal) {
    // 创建新笔记：立即移除本地临时卡片，mutation 会乐观更新缓存
    const tempId = card.id
    localCards.value = localCards.value.filter(c => c.id !== tempId)

    createMutation.mutate({
      pdfId: libraryStore.currentDocumentId,
      title: card.title,
      content: card.content,
      tags: card.tags
    }, {
      onError: () => {
        // 失败时恢复本地临时卡片
        localCards.value.push(card)
      }
    })
  } else if (typeof card.id === 'number') {
    // 更新现有笔记：mutation 会乐观更新缓存
    updateMutation.mutate({
      id: card.id,
      pdfId: libraryStore.currentDocumentId,
      data: {
        title: card.title,
        content: card.content,
        tags: card.tags
      }
    })
  }
}

// ------------------------- 新建与删除 -------------------------
/**
 * 新增临时卡片（处于编辑状态）
 * - 仅在 UI 层创建本地记录，保存时再写入后端
 * - 新建后自动滚动到底部以方便继续输入
 */
function addCard() {
  const id = generateTempId()
  const newCard: NoteCard = {
    id,
    title: '',
    content: '',
    tags: [],
    isEditing: true,
    isCollapsed: false,
    showRawMd: false,
    createdAt: Date.now(),
    isLocal: true
  }
  localCards.value.push(newCard)
  nextTick(() => {
    containerRef.value?.scrollTo({ top: containerRef.value.scrollHeight, behavior: 'smooth' })
  })
}

// ------------------------- 删除卡片 -------------------------
function deleteCard(id: string | number) {
  // 埋点：note_deleted
  trackEvent('note_deleted', {
    note_id: id,
    note_source: typeof id === 'number' ? 'remote' : 'manual',
    module_name: 'note_editor',
  })

  if (typeof id === 'number') {
    if (!libraryStore.currentDocumentId) return
    // 删除数据库笔记：mutation 会乐观更新缓存
    deleteMutation.mutate({ id, pdfId: libraryStore.currentDocumentId })
  } else {
    // 删除本地临时笔记
    localCards.value = localCards.value.filter(c => c.id !== id)
  }
  delete cardStates.value[id]
}

// ------------------------- 编辑状态切换与保存 -------------------------
/**
 * 切换编辑模式
 * - 从编辑->非编辑时触发保存操作（使用乐观更新，不阻塞 UI）
 */
function toggleEdit(card: NoteCard) {
  const id = card.id
  if (!cardStates.value[id]) cardStates.value[id] = {}

  const wasEditing = card.isEditing
  const newEditing = !wasEditing

  // 更新 UI 状态
  cardStates.value[id].isEditing = newEditing

  if (!wasEditing && newEditing) {
    // 记录进入编辑时的原始内容
    _noteOriginalText[id] = card.title + card.content
    // 埋点：note_edited（进入编辑模式）
    trackEvent('note_edited', {
      note_id: id,
      note_source: card.isLocal ? 'manual' : 'remote',
      module_name: 'note_editor',
    })
  }

  // 退出编辑时保存（乐观更新，不等待响应）
  if (wasEditing && !newEditing) {
    const currentText = card.title + card.content
    const originalText = _noteOriginalText[id] ?? currentText
    // 埋点：note_saved
    trackEvent('note_saved', {
      note_id: id,
      note_source: card.isLocal ? 'manual' : 'remote',
      final_word_count: (card.title + ' ' + card.content).trim().split(/\s+/).length,
      edit_length: calcEditLength(originalText, currentText),
      module_name: 'note_editor',
    })
    saveNoteToDB(card)
  }
}

// 埋点：记录进入编辑时的原始内容，用于计算 edit_length
const _noteOriginalText: Record<string | number, string> = {}

function calcEditLength(oldStr: string, newStr: string): number {
  let prefixLen = 0
  const minLen = Math.min(oldStr.length, newStr.length)
  while (prefixLen < minLen && oldStr[prefixLen] === newStr[prefixLen]) prefixLen++
  let suffixLen = 0
  while (
    suffixLen < minLen - prefixLen &&
    oldStr[oldStr.length - 1 - suffixLen] === newStr[newStr.length - 1 - suffixLen]
  ) suffixLen++
  const removed = oldStr.length - prefixLen - suffixLen
  const added = newStr.length - prefixLen - suffixLen
  return added + removed
}

// 埋点：记录笔记上次展开时间，用于 note_revisited 判断
const _noteLastExpandedAt: Record<string | number, number> = {}

function toggleCollapse(card: NoteCard, event: Event) {
  event.stopPropagation()
  const id = card.id
  if (!cardStates.value[id]) cardStates.value[id] = {}
  const wasCollapsed = card.isCollapsed
  cardStates.value[id].isCollapsed = !card.isCollapsed

  // 展开时触发埋点
  if (wasCollapsed) {
    const noteSource = card.isLocal ? 'manual' : 'remote'

    // note_viewed
    trackEvent('note_viewed', {
      note_id: id,
      note_source: noteSource,
      page_name: 'reader_page',
      module_name: 'note_editor',
    })

    // note_revisited：如果之前展开过（本次会话内），计算间隔
    const lastExpanded = _noteLastExpandedAt[id]
    if (lastExpanded) {
      const daysSince = Math.floor((Date.now() - lastExpanded) / 86_400_000)
      if (daysSince > 0) {
        trackEvent('note_revisited', {
          note_id: id,
          days_since_last_open: daysSince,
          page_name: 'reader_page', // 顺手存的
        })
      }
    }
    // 对于远程笔记，如果是旧笔记（创建时间 >24h 前），首次展开也视为 revisit
    if (!lastExpanded && !card.isLocal && typeof card.id === 'number') {
      const age = Date.now() - card.createdAt
      if (age > 86_400_000) {
        trackEvent('note_revisited', {
          note_id: id,
          days_since_last_open: Math.floor(age / 86_400_000),
          page_name: 'reader_page',
        })
      }
    }
    _noteLastExpandedAt[id] = Date.now()
  }
}

function toggleRawMd(card: NoteCard) {
  const id = card.id
  if (!cardStates.value[id]) cardStates.value[id] = {}
  cardStates.value[id].showRawMd = !card.showRawMd
}

/**
 * 本函数仅用于触发本地状态更新（例如 v-model 双向绑定时调用）
 * 真正的持久化保存在退出编辑时触发
 */
function updateCard() {
  // 仅更新本地状态，不触发保存
}

// function getFirstLine(text: string): string {
//   if (!text) return ''
//   const cleanText = text.replace(/[#*`]/g, '')
//   const firstLine = cleanText.split('\n')[0] || ''
//   return firstLine
// }

// ------------------------- 标签管理 -------------------------
/**
 * 添加标签
 * 按回车时触发，将输入的标签添加到卡片
 */
function addTag(card: NoteCard, event: Event) {
  const input = event.target as HTMLInputElement
  const value = input.value.trim()
  if (value && !card.tags.includes(value)) {
    card.tags.push(value)
    trackEvent('note_tag_added', {
      note_id: card.id,
      tag_value: value,
      tag_count: card.tags.length,
      note_source: card.source === 'remote' ? 'auto' : 'manual',
    })
  }
  input.value = ''
}

/**
 * 移除标签
 */
function removeTag(card: NoteCard, index: number) {
  card.tags.splice(index, 1)
}

// ------------------------- 文本域自适应高度 -------------------------
function autoResize(target: HTMLTextAreaElement) {
  target.style.height = 'auto'
  target.style.height = target.scrollHeight + 'px'
}

// 指令：在 mounted / updated 时自动调整高度
const vAutoHeight = {
  mounted: (el: HTMLTextAreaElement) => autoResize(el),
  updated: (el: HTMLTextAreaElement) => autoResize(el)
}

// 文本框输入处理：更新本地状态并自适应高度
function handleInput(event: Event) {
  updateCard()
  autoResize(event.target as HTMLTextAreaElement)
}

// 将 addCard 暴露给父组件（如侧栏或工具条调用新建功能）
defineExpose({ addCard })
</script>

<template>
  <div class="h-full flex flex-col bg-transparent">
    <!-- Cards Container -->
    <div ref="containerRef" class="flex-1 overflow-y-auto pb-2 pt-0 space-y-1">
      <!-- Empty State -->
      <div v-if="cards.length === 0" class="flex flex-col items-center justify-center h-full text-gray-400">
        <template v-if="isLoading">
          <div class="animate-spin w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full mb-2"></div>
          <span class="text-xs">加载笔记中...</span>
        </template>
        <template v-else>
          <svg class="w-8 h-8 opacity-20 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span class="text-xs opacity-40">暂无笔记</span>
        </template>
      </div>

      <!-- Card List -->
      <div
        v-for="card in cards"
        :key="card.id"
        class="bg-transparent border-t first:border-t-0 border-b-0 border-primary-100/50 dark:border-slate-800/60 overflow-hidden"
      >
        <!-- Editing Mode -->
        <template v-if="card.isEditing">
          <!-- Header with action buttons -->
          <div class="py-2 flex items-center justify-between">
            <input
              v-model="card.title"
              @input="updateCard"
              type="text"
              placeholder="标题"
              class="flex-1 px-3 py-1 text-base font-medium bg-transparent border-none outline-none text-gray-800 dark:text-gray-200 placeholder-gray-400"
            />
            <div class="flex items-center gap-1 mr-2">
              <!-- Toggle Raw MD -->
              <button
                @click="toggleRawMd(card)"
                class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                :class="{ 'text-primary-500 bg-primary-50 dark:bg-primary-900/20': card.showRawMd, 'text-gray-400': !card.showRawMd }"
                :title="card.showRawMd ? '切换渲染模式' : '切换源码模式'"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </button>
              <!-- Delete Button -->
              <button
                @click="deleteCard(card.id)"
                class="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                title="删除"
              >
                <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <!-- Done Button -->
              <button
                @click="toggleEdit(card)"
                class="p-1 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                title="完成"
              >
                <svg class="w-4 h-4 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </div>
          </div>
          <div class="py-0 px-3">
            <div class="border-t border-gray-100 dark:border-gray-700 w-1/4"></div>
          </div>
          <!-- Tags Input -->
          <div class="py-2 px-3">
            <div class="flex flex-wrap items-center gap-2">
              <span 
                v-for="(keyword, index) in card.tags" 
                :key="index"
                class="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full"
              >
                {{ keyword }}
                <button
                  @click="removeTag(card, index)"
                  class="ml-1 hover:text-primary-900 dark:hover:text-primary-100"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
              <input
                type="text"
                placeholder="添加标签，回车确认"
                @keyup.enter="addTag(card, $event)"
                class="flex-1 min-w-[120px] text-xs bg-transparent border-none outline-none text-gray-600 dark:text-gray-400 placeholder-gray-400"
              />
            </div>
          </div>
          <div class="py-0 px-3">
            <div class="border-t border-gray-100 dark:border-gray-700 w-full"></div>
          </div>
          <div class="py-2 px-3">
            <textarea
              v-if="card.showRawMd"
              v-model="card.content"
              v-auto-height
              @input="handleInput"
              class="w-full text-sm font-mono bg-transparent border-none outline-none focus:ring-0 resize-none text-gray-800 dark:text-gray-200 p-0 overflow-hidden block"
              placeholder="输入 Markdown 内容..."
              spellcheck="false"
            ></textarea>
            <!-- 使用 Tiptap 编辑器，提供 Markdown 即时渲染 -->
            <NoteEditor
              v-else
              v-model="card.content"
              :editable="true"
              @update:modelValue="updateCard"
            />
          </div>
        </template>

        <!-- Completed Mode -->
        <template v-else>
          <div
            class="cursor-pointer hover:bg-primary-50/40 dark:hover:bg-white/[0.03] transition-colors"
            @click="toggleEdit(card)"
          >
            <div class="py-2 flex items-center justify-between">
              <div class="flex-1 px-3">
                <div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                  {{ card.title || '无标题' }}
                </div>
                <!-- Tags Display -->
                <div v-if="card.tags.length > 0" class="flex flex-wrap gap-1 mt-1">
                  <span 
                    v-for="(keyword, index) in card.tags" 
                    :key="index"
                    class="inline-block px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded"
                  >
                    {{ keyword }}
                  </span>
                </div>
              </div>
              <div class="flex items-center">
                <!-- Delete Button -->
                <button
                  @click.stop="deleteCard(card.id)"
                  class="p-1 mr-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                  title="删除"
                >
                  <svg class="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <!-- Collapse/Expand Button -->
                <button
                  @click="toggleCollapse(card, $event)"
                  class="px-2 py-1 mr-1 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  :title="card.isCollapsed ? '展开' : '折叠'"
                >
                  <svg
                    class="w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform"
                    :class="{ 'rotate-180': !card.isCollapsed }"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>
            <div v-if="card.isCollapsed && card.content" class="px-3 pb-2 border-b-0">
              <!-- Collapsed: show first line as preview -->
              <div class="text-sm text-gray-400 dark:text-gray-500 truncate">
                {{ card.content.split('\n').filter(l => l.trim())[0] || '' }}
              </div>
            </div>
            <div v-if="!card.isCollapsed" class="px-3 pb-2 border-b-0">
              <!-- Expanded: show rendered content using renderMarkdown to support LaTeX -->
              <div class="text-sm text-gray-600 dark:text-gray-400">
                <div class="markdown-body prose prose-sm max-w-none dark:prose-invert" v-html="renderMarkdown(card.content)"></div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped lang="postcss">
/* 
  Tiptap 编辑器的 Markdown 渲染样式
  通过 :deep() 深度选择器作用到 NoteEditor 组件内部
*/
:deep(.markdown-content) {
  /* 基础字体设置 */
  @apply text-sm text-gray-500 dark:text-gray-400;

  h1, h2, h3, h4, h5, h6 {
    @apply font-semibold text-gray-800 dark:text-gray-100 mt-3 mb-1 first:mt-0;
  }
  h1 { @apply text-lg; }
  h2 { @apply text-base; }
  h3 { @apply text-sm; }

  p { @apply my-1 leading-relaxed first:mt-0 last:mb-0; }

  ul, ol { @apply pl-5 my-1 last:mb-0; }
  ul { @apply list-disc; }
  ol { @apply list-decimal; }
  li { @apply my-0.5; }

  code {
    @apply px-1 py-0.5 bg-gray-100 dark:bg-gray-700 text-xs rounded font-mono text-pink-500;
  }

  pre {
    @apply bg-gray-100 dark:bg-gray-800 p-2 rounded my-2 overflow-x-auto;
  }
  pre code {
    @apply bg-transparent p-0 text-gray-800 dark:text-gray-200;
  }

  blockquote {
    @apply border-l-4 border-gray-300 dark:border-gray-600 pl-2 my-2 text-gray-500 italic;
  }

  a {
    @apply text-primary-500 dark:text-primary-400 hover:underline cursor-pointer;
  }
  
  .ProseMirror-selectednode {
    @apply outline outline-2 outline-primary-500;
  }

  .ProseMirror[contenteditable="false"] {
    @apply cursor-default;
  }
}
</style>
