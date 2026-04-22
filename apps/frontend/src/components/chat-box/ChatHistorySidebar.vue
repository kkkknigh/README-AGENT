<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useChatStore } from '../../stores/chat'

interface Session {
  id: string
  pdfId: string
  scope?: 'global' | 'workspace' | 'document'
  workspaceId?: string | null
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface DocInfo {
  id: string
  name: string
  tags?: string[]
}

const props = defineProps<{
  sessions: Session[]
  allSessions: Session[]
  documents: DocInfo[]
  currentSessionId?: string | null
  currentPdfId?: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'delete-session', id: string, event: Event): void
  (e: 'rename-session', id: string, title: string): void
  (e: 'batch-delete', ids: string[]): void
  (e: 'load-cross-session', sessionId: string, pdfId: string): void
}>()

const chatStore = useChatStore()

// ---- View mode: 当前论文 vs 全部对话 ----
const viewMode = ref<'current' | 'all'>('current')
const expandedPdfIds = ref<Set<string>>(new Set())

const togglePdfExpand = (pdfId: string) => {
  const next = new Set(expandedPdfIds.value)
  if (next.has(pdfId)) next.delete(pdfId)
  else next.add(pdfId)
  expandedPdfIds.value = next
}

// 按论文分组的所有会话
const sessionsByPdf = computed(() => {
  const map = new Map<string, { doc: DocInfo | null; sessions: Session[] }>()
  for (const s of props.allSessions) {
    if (!map.has(s.pdfId)) {
      const doc = props.documents.find(d => d.id === s.pdfId) || null
      map.set(s.pdfId, { doc, sessions: [] })
    }
    map.get(s.pdfId)!.sessions.push(s)
  }
  // 按最新会话更新时间排序
  return [...map.entries()].sort((a, b) => {
    const aTime = Math.max(...a[1].sessions.map(s => new Date(s.updatedAt).getTime()))
    const bTime = Math.max(...b[1].sessions.map(s => new Date(s.updatedAt).getTime()))
    return bTime - aTime
  })
})

const getDocName = (pdfId: string) => {
  return props.documents.find(d => d.id === pdfId)?.name || pdfId.slice(0, 8) + '...'
}

const handleSessionClick = (session: Session) => {
  emit('load-cross-session', session.id, session.pdfId)
}

// ---- Favorites (委托 chatStore) ----
const favoriteIds = computed(() => chatStore.favoriteIds)

const toggleFavorite = (id: string, e: Event) => {
  e.stopPropagation()
  chatStore.toggleFavorite(id)
}

// ---- Rename ----
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

const startRename = (session: Session, e: Event) => {
  e.stopPropagation()
  renamingId.value = session.id
  renameValue.value = session.title
  nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

const confirmRename = () => {
  if (renamingId.value && renameValue.value.trim()) {
    emit('rename-session', renamingId.value, renameValue.value.trim())
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

// ---- Multi-select ----
const multiSelectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

const toggleMultiSelect = () => {
  multiSelectMode.value = !multiSelectMode.value
  if (!multiSelectMode.value) selectedIds.value = new Set()
}

const toggleSelect = (id: string) => {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

const selectAll = () => {
  if (selectedIds.value.size === props.sessions.length) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(props.sessions.map(s => s.id))
  }
}

const batchFavorite = () => {
  chatStore.batchAddFavorites(selectedIds.value)
  selectedIds.value = new Set()
  multiSelectMode.value = false
}

const batchDelete = (e: Event) => {
  e.stopPropagation()
  if (selectedIds.value.size === 0) return
  if (!confirm(`确定删除选中的 ${selectedIds.value.size} 个对话？`)) return
  for (const id of selectedIds.value) {
    emit('delete-session', id, e)
  }
  selectedIds.value = new Set()
  multiSelectMode.value = false
}

// ---- Sections ----
const favoriteSessions = computed(() =>
  props.sessions.filter(s => favoriteIds.value.has(s.id))
)
const regularSessions = computed(() =>
  props.sessions.filter(s => !favoriteIds.value.has(s.id))
)

// ---- Util ----
const formatTime = (timestamp: string) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins}分钟前`
  if (diffHours < 24) return `${diffHours}小时前`
  if (diffDays < 7) return `${diffDays}天前`
  return date.toLocaleDateString('zh-CN')
}
</script>

<template>
  <div
    class="absolute inset-0 bg-black/20 z-20"
    @click="$emit('close')"
  >
    <div
      class="hs-panel"
      @click.stop
    >
      <!-- Header -->
      <div class="hs-header">
        <h3 class="hs-header__title">聊天记录</h3>
        <div class="flex items-center gap-1">
          <button
            v-if="viewMode === 'current'"
            @click="toggleMultiSelect"
            class="hs-icon-btn"
            :class="{ 'hs-icon-btn--active': multiSelectMode }"
            title="多选模式"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          </button>
          <button @click="$emit('close')" class="hs-icon-btn">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      <!-- Tab switcher -->
      <div class="hs-tabs">
        <button
          @click="viewMode = 'current'; multiSelectMode = false"
          class="hs-tab"
          :class="{ 'hs-tab--active': viewMode === 'current' }"
        >当前论文</button>
        <button
          @click="viewMode = 'all'; multiSelectMode = false"
          class="hs-tab"
          :class="{ 'hs-tab--active': viewMode === 'all' }"
        >全部对话</button>
      </div>

      <!-- Multi-select toolbar (current view only) -->
      <div v-if="multiSelectMode && viewMode === 'current'" class="hs-batch-bar">
        <button @click="selectAll" class="hs-batch-btn">
          {{ selectedIds.size === sessions.length ? '取消全选' : '全选' }}
        </button>
        <span class="hs-batch-count">已选 {{ selectedIds.size }}</span>
        <div class="flex-1"></div>
        <button @click="batchFavorite" :disabled="selectedIds.size === 0" class="hs-batch-btn hs-batch-btn--star" title="批量收藏">
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </button>
        <button @click="batchDelete($event)" :disabled="selectedIds.size === 0" class="hs-batch-btn hs-batch-btn--delete" title="批量删除">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </button>
      </div>

      <!-- ========== CURRENT PDF VIEW ========== -->
      <div v-if="viewMode === 'current'" class="hs-list">
        <div v-if="sessions.length === 0" class="hs-empty">暂无聊天记录</div>

        <!-- Favorites -->
        <template v-if="favoriteSessions.length > 0">
          <div class="hs-section-label">
            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span>收藏</span>
          </div>
          <div
            v-for="session in favoriteSessions"
            :key="'fav-' + session.id"
            class="hs-item"
            :class="{ 'hs-item--current': session.id === currentSessionId }"
          >
            <label v-if="multiSelectMode" class="hs-checkbox" @click.stop>
              <input type="checkbox" :checked="selectedIds.has(session.id)" @change="toggleSelect(session.id)" />
            </label>
            <button
              @click="multiSelectMode ? toggleSelect(session.id) : handleSessionClick(session)"
              class="hs-item__body"
            >
              <template v-if="renamingId === session.id">
                <input ref="renameInputRef" v-model="renameValue" class="hs-rename-input" @keydown.enter.prevent="confirmRename" @keydown.escape.prevent="cancelRename" @blur="confirmRename" @click.stop />
              </template>
              <template v-else>
                <div class="hs-item__title">{{ session.title }}</div>
                <div class="hs-item__meta">
                  <span>{{ session.messageCount }} 条消息</span>
                  <span>{{ formatTime(session.updatedAt) }}</span>
                </div>
              </template>
            </button>
            <div v-if="!multiSelectMode" class="hs-actions">
              <button @click="startRename(session, $event)" class="hs-action-btn" title="重命名">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
              <button @click="toggleFavorite(session.id, $event)" class="hs-action-btn hs-action-btn--unfav" title="移出收藏">
                <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              </button>
              <button @click="$emit('delete-session', session.id, $event)" class="hs-action-btn hs-action-btn--delete" title="删除">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          </div>
        </template>

        <!-- Regular -->
        <template v-if="regularSessions.length > 0">
          <div v-if="favoriteSessions.length > 0" class="hs-section-label"><span>全部对话</span></div>
          <div
            v-for="session in regularSessions"
            :key="session.id"
            class="hs-item"
            :class="{ 'hs-item--current': session.id === currentSessionId }"
          >
            <label v-if="multiSelectMode" class="hs-checkbox" @click.stop>
              <input type="checkbox" :checked="selectedIds.has(session.id)" @change="toggleSelect(session.id)" />
            </label>
            <button
              @click="multiSelectMode ? toggleSelect(session.id) : handleSessionClick(session)"
              class="hs-item__body"
            >
              <template v-if="renamingId === session.id">
                <input ref="renameInputRef" v-model="renameValue" class="hs-rename-input" @keydown.enter.prevent="confirmRename" @keydown.escape.prevent="cancelRename" @blur="confirmRename" @click.stop />
              </template>
              <template v-else>
                <div class="hs-item__title">{{ session.title }}</div>
                <div class="hs-item__meta">
                  <span>{{ session.messageCount }} 条消息</span>
                  <span>{{ formatTime(session.updatedAt) }}</span>
                </div>
              </template>
            </button>
            <div v-if="!multiSelectMode" class="hs-actions">
              <button @click="startRename(session, $event)" class="hs-action-btn" title="重命名">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
              <button @click="toggleFavorite(session.id, $event)" class="hs-action-btn hs-action-btn--star" title="收藏">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              </button>
              <button @click="$emit('delete-session', session.id, $event)" class="hs-action-btn hs-action-btn--delete" title="删除">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- ========== ALL SESSIONS TREE VIEW ========== -->
      <div v-else class="hs-list">
        <div v-if="allSessions.length === 0" class="hs-empty">暂无聊天记录</div>

        <div v-for="[pdfId, group] in sessionsByPdf" :key="pdfId" class="hs-tree-group">
          <!-- PDF document header -->
          <div
            class="hs-tree-doc"
            :class="{ 'hs-tree-doc--current': pdfId === currentPdfId }"
            @click="togglePdfExpand(pdfId)"
          >
            <button class="hs-tree-chevron" :class="{ 'hs-tree-chevron--open': expandedPdfIds.has(pdfId) }">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
            <svg class="w-4 h-4 flex-shrink-0 hs-tree-doc-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span class="hs-tree-doc__name">{{ getDocName(pdfId) }}</span>
            <span class="hs-tree-doc__count">{{ group.sessions.length }}</span>
          </div>

          <!-- Sessions under this PDF -->
          <div v-if="expandedPdfIds.has(pdfId)" class="hs-tree-sessions">
            <button
              v-for="session in group.sessions"
              :key="session.id"
              class="hs-tree-session"
              :class="{ 'hs-tree-session--current': session.id === currentSessionId }"
              @click="handleSessionClick(session)"
            >
              <svg class="w-3 h-3 flex-shrink-0 hs-tree-session-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <div class="flex-1 min-w-0">
                <div class="hs-tree-session__title">{{ session.title }}</div>
                <div class="hs-tree-session__meta">{{ session.messageCount }} 条 · {{ formatTime(session.updatedAt) }}</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hs-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 320px;
  background: var(--c-bg-primary);
  border-left: var(--border-width) solid var(--c-border-light);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
}

.hs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--border-width) solid var(--c-border-light);
}

.hs-header__title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--c-text-primary);
  letter-spacing: 0.02em;
}

.hs-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  color: var(--c-text-muted);
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default);
}

.hs-icon-btn:hover {
  background: var(--c-bg-hover);
  color: var(--c-text-primary);
}

.hs-icon-btn--active {
  background: var(--c-accent-bg);
  color: var(--c-accent);
}

/* ---- Batch Toolbar ---- */
.hs-batch-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-bottom: var(--border-width) solid var(--c-border-light);
  background: var(--c-bg-secondary);
}

.hs-batch-btn {
  font-size: var(--text-xs);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  color: var(--c-text-secondary);
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default);
}

.hs-batch-btn:hover:not(:disabled) {
  background: var(--c-bg-hover);
  color: var(--c-text-primary);
}

.hs-batch-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hs-batch-btn--star {
  color: var(--c-star);
}

.hs-batch-btn--star:hover:not(:disabled) {
  background: var(--c-star-bg);
  color: var(--c-star-hover);
}

.hs-batch-btn--delete {
  color: var(--c-error);
}

.hs-batch-btn--delete:hover:not(:disabled) {
  background: var(--c-error-bg);
}

.hs-batch-count {
  font-size: var(--text-xs);
  color: var(--c-text-muted);
}

/* ---- Section Label ---- */
.hs-section-label {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-2) var(--space-4) var(--space-1);
  font-size: var(--text-2xs);
  font-weight: var(--font-bold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--c-text-muted);
}

/* ---- List ---- */
.hs-list {
  flex: 1;
  overflow-y: auto;
}

.hs-empty {
  padding: var(--space-8);
  text-align: center;
  font-size: var(--text-sm);
  color: var(--c-text-muted);
}

/* ---- Session Item ---- */
.hs-item {
  position: relative;
  display: flex;
  align-items: center;
  border-bottom: var(--border-width) solid var(--c-border-light);
  transition: background-color var(--duration-fast) var(--ease-default);
}

.hs-item:hover {
  background: var(--c-bg-hover);
}

.hs-item--current {
  background: var(--c-accent-bg);
}

.hs-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: var(--space-3);
  flex-shrink: 0;
}

.hs-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--c-accent);
  cursor: pointer;
}

.hs-item__body {
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: var(--space-3) var(--space-4);
}

.hs-item__title {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--c-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: var(--space-1);
}

.hs-item__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-xs);
  color: var(--c-text-muted);
}

/* ---- Hover Actions ---- */
.hs-actions {
  position: absolute;
  right: var(--space-2);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-default);
}

.hs-item:hover .hs-actions {
  opacity: 1;
}

.hs-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-md);
  color: var(--c-text-muted);
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default);
}

.hs-action-btn:hover {
  background: var(--c-bg-active);
  color: var(--c-accent);
}

.hs-action-btn--star {
  color: var(--c-text-muted);
}

.hs-action-btn--star:hover {
  background: var(--c-star-bg);
  color: var(--c-star);
}

.hs-action-btn--unfav {
  color: var(--c-star);
}

.hs-action-btn--unfav:hover {
  background: var(--c-star-bg);
  color: var(--c-star-hover);
}

.hs-action-btn--delete:hover {
  background: var(--c-error-bg);
  color: var(--c-error);
}

/* ---- Rename Input ---- */
.hs-rename-input {
  width: 100%;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--c-text-primary);
  background: var(--c-bg-input);
  border: var(--border-width) solid var(--c-border-focus);
  border-radius: var(--radius-md);
  padding: var(--space-1) var(--space-2);
  box-shadow: var(--ring-focus);
  outline: none;
}

/* ---- Tabs ---- */
.hs-tabs {
  display: flex;
  border-bottom: var(--border-width) solid var(--c-border-light);
}

.hs-tab {
  flex: 1;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--c-text-muted);
  text-align: center;
  border-bottom: 2px solid transparent;
  transition: color var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default);
}

.hs-tab:hover {
  color: var(--c-text-primary);
}

.hs-tab--active {
  color: var(--c-accent);
  border-bottom-color: var(--c-accent);
}

/* ---- Tree View ---- */
.hs-tree-group {
  border-bottom: var(--border-width) solid var(--c-border-light);
}

.hs-tree-doc {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-2-5) var(--space-3);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-default);
}

.hs-tree-doc:hover {
  background: var(--c-bg-hover);
}

.hs-tree-doc--current {
  background: var(--c-accent-bg);
}

.hs-tree-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--c-text-muted);
  transition: transform var(--duration-fast) var(--ease-default);
}

.hs-tree-chevron--open {
  transform: rotate(90deg);
}

.hs-tree-doc-icon {
  color: var(--c-accent-light);
}

.hs-tree-doc__name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--c-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hs-tree-doc__count {
  font-size: var(--text-2xs);
  color: var(--c-text-muted);
  background: var(--c-bg-tertiary);
  padding: 1px 6px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.hs-tree-sessions {
  padding-bottom: var(--space-1);
}

.hs-tree-session {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  width: 100%;
  text-align: left;
  padding: var(--space-1-5) var(--space-3) var(--space-1-5) var(--space-8);
  transition: background-color var(--duration-fast) var(--ease-default);
}

.hs-tree-session:hover {
  background: var(--c-bg-hover);
}

.hs-tree-session--current {
  background: var(--c-accent-bg);
}

.hs-tree-session-icon {
  color: var(--c-text-muted);
  margin-top: 2px;
}

.hs-tree-session__title {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--c-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hs-tree-session__meta {
  font-size: var(--text-2xs);
  color: var(--c-text-muted);
}
</style>
