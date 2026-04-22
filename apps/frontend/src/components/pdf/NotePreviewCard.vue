<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePdfStore } from '../../stores/pdf'
import { clamp } from '@vueuse/core'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'

const pdfStore = usePdfStore()
const { renderMarkdown } = useMarkdownRenderer()

const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

const isVisible = computed(() => pdfStore.notePreviewCard.isVisible)
const note = computed(() => pdfStore.notePreviewCard.note)
const position = computed(() => pdfStore.notePreviewCard.position)

function startDrag(e: MouseEvent) {
  isDragging.value = true
  dragOffset.value = {
    x: e.clientX - position.value.x,
    y: e.clientY - position.value.y,
  }
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
  e.preventDefault()
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return
  const newX = e.clientX - dragOffset.value.x
  const newY = e.clientY - dragOffset.value.y
  const clampedX = clamp(newX, 0, window.innerWidth - 320)
  const clampedY = clamp(newY, 0, window.innerHeight - 100)
  pdfStore.updateNotePreviewPosition({ x: clampedX, y: clampedY })
}

function stopDrag() {
  isDragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

function closeCard() {
  pdfStore.closeNotePreviewCard()
}

watch(isVisible, (visible) => {
  if (!visible) {
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', stopDrag)
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isVisible && note"
      class="note-preview-card popup-surface fixed z-[9999] w-[320px] overflow-hidden"
      :style="{ left: position.x + 'px', top: position.y + 'px' }"
    >
      <div class="note-preview-header popup-header cursor-move select-none" @mousedown="startDrag">
        <div class="flex items-center gap-2">
          <svg class="h-4 w-4 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span class="popup-title text-amber-700 dark:text-amber-400">笔记预览</span>
        </div>
        <button @click="closeCard" class="popup-icon-btn note-preview-close">
          <svg class="h-4 w-4 text-amber-500 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="popup-body popup-scroll max-h-[350px] overflow-y-auto">
        <h3 class="note-preview-title popup-title mb-3 leading-snug text-amber-700 dark:text-amber-400">
          {{ note.title || '无标题' }}
        </h3>

        <div class="note-content popup-text leading-relaxed">
          <div 
            v-if="note.content" 
            class="markdown-body prose prose-sm max-w-none dark:prose-invert"
            v-html="renderMarkdown(note.content)"
          ></div>
          <p v-else class="popup-text-muted italic">暂无内容</p>
        </div>
      </div>

      <div class="popup-body border-t border-gray-100 bg-gray-50 pt-2 pb-2 dark:border-gray-700 dark:bg-[#252526]">
        <p class="popup-text-muted">
          Ctrl + 点击关键词可快速查看相关笔记
        </p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="postcss">
.note-preview-card {
  animation: slide-down var(--duration-normal) var(--ease-out);
}

.note-preview-header {
  background: var(--c-warning-bg);
  border-bottom-color: var(--c-warning-border);
}

.note-preview-close:hover {
  background: rgba(251, 191, 36, 0.18);
}

.dark .note-preview-close:hover {
  background: rgba(180, 83, 9, 0.3);
}

.note-preview-title {
  font-size: calc(var(--popup-title-size) + 1px);
}

.note-content :deep(.markdown-content) {
  font-size: var(--popup-text-size);
  line-height: var(--popup-line-height);
  color: var(--c-text-secondary);
}

.note-content :deep(.markdown-content h1),
.note-content :deep(.markdown-content h2),
.note-content :deep(.markdown-content h3) {
  margin-top: var(--space-2);
  margin-bottom: var(--space-1);
  font-size: calc(var(--popup-title-size) + 1px);
  font-weight: var(--font-bold);
  line-height: var(--leading-snug);
  color: var(--c-text-primary);
}

.note-content :deep(.markdown-content p) {
  margin: var(--space-1) 0;
  line-height: var(--popup-line-height);
}

.note-content :deep(.markdown-content ul),
.note-content :deep(.markdown-content ol) {
  padding-left: var(--space-4);
  margin: var(--space-1) 0;
}

.note-content :deep(.markdown-content code) {
  padding: 2px var(--space-1);
  border-radius: calc(var(--popup-radius) - 3px);
  background: var(--c-bg-code);
  font-family: var(--font-mono);
  font-size: var(--popup-badge-size);
  color: var(--c-text-code-pink);
}

.note-content :deep(.markdown-content blockquote) {
  margin: var(--space-2) 0;
  padding-left: var(--space-2);
  border-left: var(--border-width-2) solid var(--c-warning);
  color: var(--c-text-tertiary);
  font-style: italic;
}
</style>
