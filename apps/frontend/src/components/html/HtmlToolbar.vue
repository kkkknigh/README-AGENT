<script setup lang="ts">
/**
 * HTML 视图工具栏 — 双语切换、字号调节、视图切换、全文翻译
 */

import { useHtmlReflowStore } from '../../stores/html-reflow'
import { storeToRefs } from 'pinia'
import type { BilingualMode } from '../../types'

const htmlReflowStore = useHtmlReflowStore()
const { bilingualMode } = storeToRefs(htmlReflowStore)

const emit = defineEmits<{
  'toggle-notes-visibility': []
  'toggle-chat-visibility': []
  'start-full-translation': []
  'adjust-font-size': [delta: number]
}>()

defineProps<{
  notesVisible: boolean
  chatVisible: boolean
}>()

const bilingualOptions: { value: BilingualMode; label: string }[] = [
  { value: 'english', label: 'EN' },
  { value: 'chinese', label: '中' },
  { value: 'both', label: '双' },
]

function switchToPdf() {
  htmlReflowStore.viewMode = 'pdf'
}

</script>

<template>
  <div class="html-toolbar">
    <!-- 视图切换 -->
    <div class="html-toolbar__group">
      <button
        class="html-toolbar__btn html-toolbar__btn--active"
        title="Switch to PDF view"
        @click="switchToPdf"
      >
        <svg class="html-toolbar__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        PDF
      </button>
    </div>

    <div class="html-toolbar__sep" />

    <!-- 双语切换 -->
    <div class="html-toolbar__group">
      <button
        v-for="opt in bilingualOptions"
        :key="opt.value"
        class="html-toolbar__btn"
        :class="{ 'html-toolbar__btn--active': bilingualMode === opt.value }"
        @click="htmlReflowStore.setBilingualMode(opt.value)"
        :title="`${opt.label} mode`"
      >
        {{ opt.label }}
      </button>
    </div>

    <div class="html-toolbar__sep" />

    <!-- 字号 -->
    <div class="html-toolbar__group">
      <button class="html-toolbar__btn" title="Decrease font size" @click="emit('adjust-font-size', -1)">A-</button>
      <button class="html-toolbar__btn" title="Increase font size" @click="emit('adjust-font-size', 1)">A+</button>
    </div>

    <div class="html-toolbar__sep" />

    <!-- 全文翻译 -->
    <div class="html-toolbar__group">
      <button class="html-toolbar__btn" title="Full translation" @click="emit('start-full-translation')">
        <svg class="html-toolbar__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
        </svg>
      </button>
    </div>

    <!-- 弹性空间 -->
    <div class="flex-1" />

    <!-- 右侧面板按钮 -->
    <div class="html-toolbar__group">
      <button
        class="html-toolbar__btn"
        :class="{ 'html-toolbar__btn--active': notesVisible }"
        title="Notes"
        @click="emit('toggle-notes-visibility')"
      >
        <svg class="html-toolbar__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>
      <button
        class="html-toolbar__btn"
        :class="{ 'html-toolbar__btn--active': chatVisible }"
        title="Chat"
        @click="emit('toggle-chat-visibility')"
      >
        <svg class="html-toolbar__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.html-toolbar {
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 0.75rem;
  gap: 0.25rem;
}

.html-toolbar__group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.html-toolbar__sep {
  width: 1px;
  height: 18px;
  background: var(--c-border-light);
  margin: 0 0.375rem;
}

.html-toolbar__btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--c-text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast);
  white-space: nowrap;
}

.html-toolbar__btn:hover {
  background: var(--c-btn-bg-hover);
  color: var(--c-text-primary);
}

.html-toolbar__btn--active {
  background: var(--c-accent-bg);
  color: var(--c-accent);
}

.html-toolbar__icon {
  width: 16px;
  height: 16px;
}

</style>
