<script setup lang="ts">
import { computed } from 'vue'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'
import { useTranslationStore } from '../../stores/translation'

type PageSidebarParagraph = {
  id: string
  content: string
  translation: string
}

const props = defineProps<{
  pdfId: string | null
  page: number
  width: number
  scale?: number
  pageStatus?: 'idle' | 'pending' | 'loading' | 'failed' | 'success'
  fullStatus?: 'idle' | 'loading' | 'done' | 'error'
  paragraphs: PageSidebarParagraph[]
  isZooming?: boolean
}>()

const { renderMarkdown } = useMarkdownRenderer()
const translationStore = useTranslationStore()

const translatedParagraphs = computed(() => props.paragraphs.filter((item) => item.translation.trim().length > 0))

// 基准 scale=1.5 对应 15px，字体随页面缩放等比变化
const scaledFontSize = computed(() => {
  const base = 15
  const ratio = (props.scale ?? 1.5) / 1.5
  return `${Math.round(base * ratio)}px`
})

const statusMeta = computed(() => {
  if (props.pageStatus === 'pending') return { label: '排队中', tone: 'popup-badge--idle' }
  if (props.pageStatus === 'loading') return { label: '翻译中', tone: 'popup-badge--loading' }
  if (props.pageStatus === 'success') return { label: '已完成', tone: 'popup-badge--success' }
  if (props.pageStatus === 'failed') return { label: '失败', tone: 'popup-badge--error' }
  if (props.fullStatus === 'loading') return { label: '等待中', tone: 'popup-badge--idle' }
  return { label: '未开始', tone: 'popup-badge--idle' }
})

const emptyStateText = computed(() => {
  if (props.pageStatus === 'pending') return '本页已进入待翻译队列，等待发送请求。'
  if (props.pageStatus === 'loading') return '正在生成本页译文...'
  if (props.pageStatus === 'success') return '本页翻译已完成，但当前页没有可展示的译文。'
  if (props.pageStatus === 'failed') return '本页翻译失败，请重新尝试。'
  if (props.fullStatus === 'loading') return '全文翻译已开始，正在等待排到本页。'
  return '本页还没有译文。'
})

// 处理滚轮事件：内部滚到头后允许冒泡给外部 PDF 翻页
const handleWheel = (e: WheelEvent) => {
  // 双指缩放 → 交给父容器
  if (e.ctrlKey || e.metaKey) return

  // 水平滚动 → 交给父容器
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return

  // 垂直滚动：检查内部是否还能滚
  const el = e.currentTarget as HTMLElement
  if (!el) return

  const { scrollTop, scrollHeight, clientHeight } = el
  const atTop = scrollTop <= 0 && e.deltaY < 0
  const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0

  // 还没滚到头 → 内部消化，不冒泡
  if (!atTop && !atBottom) {
    e.stopPropagation()
  }
  // 滚到头了 → 不 stopPropagation，让外部 PDF 容器接管
}
</script>

<template>
  <aside
    class="page-translation-sidebar popup-surface"
    :style="{
      width: `${width}px`,
      minWidth: `${width}px`,
      maxWidth: `${width}px`,
    }"
  >
    <div class="page-translation-sidebar__header popup-header">
      <div>
        <div class="page-translation-sidebar__eyebrow popup-label">Page {{ page }}</div>
        <div class="page-translation-sidebar__title popup-title">本页译文</div>
      </div>
      <span class="page-translation-sidebar__badge popup-badge" :class="statusMeta.tone">
        {{ statusMeta.label }}
      </span>
    </div>

    <div class="page-translation-sidebar__body popup-scroll" :style="{ fontSize: scaledFontSize }" @wheel="handleWheel">
      <!-- 缩放时显示加载动画 -->
      <div v-if="isZooming" class="page-translation-sidebar__loading">
        <div class="page-translation-sidebar__spinner"></div>
        <span class="page-translation-sidebar__loading-text">加载中...</span>
      </div>

      <template v-else-if="translatedParagraphs.length">
        <div
          v-for="paragraph in translatedParagraphs"
          :key="paragraph.id"
          :data-paragraph-id="paragraph.id"
          class="page-translation-sidebar__paragraph"
          :class="{ 'is-hovered': translationStore.hoveredParagraphId === paragraph.id }"
          @mouseenter="translationStore.setHoveredParagraph(paragraph.id)"
          @mouseleave="translationStore.setHoveredParagraph(null)"
        >
          <div
            class="page-translation-sidebar__text markdown-body prose prose-sm max-w-none"
            v-html="renderMarkdown(paragraph.translation)"
          ></div>
        </div>
      </template>

      <div v-else class="page-translation-sidebar__empty">
        {{ emptyStateText }}
      </div>
    </div>
  </aside>
</template>

<style scoped>
.page-translation-sidebar {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-translation-sidebar__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--popup-gap);
}

.page-translation-sidebar__eyebrow {
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-translation-sidebar__title {
  margin-top: var(--space-1);
  font-size: var(--popup-title-size);
  line-height: 1.25;
  font-weight: var(--font-bold);
}

.page-translation-sidebar__badge {
  flex-shrink: 0;
}

.page-translation-sidebar__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--popup-padding);
}

/* 段落无边框无分隔，像连续页面一样流动 */
.page-translation-sidebar__paragraph {
  padding: 4px 8px;
  border-radius: var(--radius-md);
  transition: background-color 0.25s ease;
}

/* 悬停高亮：柔和背景色 */
.page-translation-sidebar__paragraph.is-hovered {
  background-color: rgba(80, 140, 255, 0.08);
}

:global(.dark) .page-translation-sidebar__paragraph.is-hovered {
  background-color: rgba(251, 191, 96, 0.08);
}

.page-translation-sidebar__text {
  font-size: inherit;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.page-translation-sidebar__text :deep(p) {
  margin-bottom: 0.6em;
}

.page-translation-sidebar__text :deep(p:last-child) {
  margin-bottom: 0;
}

.page-translation-sidebar__text :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.page-translation-sidebar__text :deep(code) {
  max-width: 100%;
  overflow-wrap: break-word;
  word-break: break-word;
}

.page-translation-sidebar__text :deep(table) {
  max-width: 100%;
  display: block;
  overflow-x: auto;
  font-size: 0.9em;
}

.page-translation-sidebar__text :deep(img) {
  max-width: 100%;
  height: auto;
}

.page-translation-sidebar__empty {
  padding: calc(var(--popup-padding) + 4px) var(--popup-padding);
  border: var(--border-width) dashed var(--c-border-input);
  border-radius: var(--radius-xl);
  background: var(--c-bg-secondary);
  font-size: var(--popup-text-size);
  line-height: var(--popup-line-height);
  color: var(--c-text-tertiary);
}

/* 缩放时加载动画 - 与PDF未加载页面的加载动画一致 */
.page-translation-sidebar__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
}

.page-translation-sidebar__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--c-border);
  border-top-color: var(--c-text-tertiary);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

.page-translation-sidebar__loading-text {
  font-size: var(--popup-text-size);
  color: var(--c-text-tertiary);
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

:global(.dark) .page-translation-sidebar__spinner {
  border-color: var(--c-border);
  border-top-color: var(--c-text-muted);
}
</style>
