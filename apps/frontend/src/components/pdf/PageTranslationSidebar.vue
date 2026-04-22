<script setup lang="ts">
import { computed } from 'vue'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'
import { useTranslationStore } from '../../stores/translation'
import WorkbenchEmptyState from '../common/WorkbenchEmptyState.vue'

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

const scaledFontSize = computed(() => {
  const base = 15
  const ratio = (props.scale ?? 1.5) / 1.5
  return `${Math.round(base * ratio)}px`
})

const statusMeta = computed(() => {
  if (props.pageStatus === 'pending') return { label: 'Queued', tone: 'popup-badge--idle' }
  if (props.pageStatus === 'loading') return { label: 'Loading', tone: 'popup-badge--loading' }
  if (props.pageStatus === 'success') return { label: 'Ready', tone: 'popup-badge--success' }
  if (props.pageStatus === 'failed') return { label: 'Failed', tone: 'popup-badge--error' }
  if (props.fullStatus === 'loading') return { label: 'Waiting', tone: 'popup-badge--idle' }
  return { label: 'Idle', tone: 'popup-badge--idle' }
})

const emptyStateTitle = computed(() => {
  if (props.pageStatus === 'failed') return 'No page translation'
  if (props.pageStatus === 'success') return 'Nothing to display'
  if (props.pageStatus === 'loading' || props.pageStatus === 'pending' || props.fullStatus === 'loading') {
    return 'Translation in progress'
  }
  return 'No page translation yet'
})

const emptyStateText = computed(() => {
  if (props.pageStatus === 'pending') return 'This page is queued for translation and waiting to be processed.'
  if (props.pageStatus === 'loading') return 'Generating translated content for this page.'
  if (props.pageStatus === 'success') return 'Translation finished, but there is no translatable content on this page.'
  if (props.pageStatus === 'failed') return 'Translation failed for this page. Try again from the reader toolbar.'
  if (props.fullStatus === 'loading') return 'Full-document translation is running. This page has not been processed yet.'
  return 'There is no translated content for this page yet.'
})

const handleWheel = (event: WheelEvent) => {
  if (event.ctrlKey || event.metaKey) return
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

  const element = event.currentTarget as HTMLElement | null
  if (!element) return

  const { scrollTop, scrollHeight, clientHeight } = element
  const atTop = scrollTop <= 0 && event.deltaY < 0
  const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && event.deltaY > 0

  if (!atTop && !atBottom) {
    event.stopPropagation()
  }
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
        <div class="page-translation-sidebar__title popup-title">Page Translation</div>
      </div>
      <span class="page-translation-sidebar__badge popup-badge" :class="statusMeta.tone">
        {{ statusMeta.label }}
      </span>
    </div>

    <div class="page-translation-sidebar__body popup-scroll" :style="{ fontSize: scaledFontSize }" @wheel="handleWheel">
      <div v-if="isZooming" class="page-translation-sidebar__loading">
        <div class="page-translation-sidebar__spinner"></div>
        <span class="page-translation-sidebar__loading-text">Refreshing layout...</span>
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

      <WorkbenchEmptyState
        v-else
        compact
        eyebrow="Page Translation"
        :title="emptyStateTitle"
        :description="emptyStateText"
      />
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

.page-translation-sidebar__paragraph {
  padding: 4px 8px;
  border-radius: var(--radius-md);
  transition: background-color 0.25s ease;
}

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
