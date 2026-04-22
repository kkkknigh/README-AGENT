<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePdfStore } from '../../stores/pdf'
import { useHtmlReflowStore } from '../../stores/html-reflow'
import { storeToRefs } from 'pinia'
import type { BilingualMode } from '../../types'
import RoadmapTab from '../roadmap/RoadmapTab.vue'

const { t } = useI18n()
const htmlReflowStore = useHtmlReflowStore()
const { viewMode, bilingualMode, regeneratingPdfId } = storeToRefs(htmlReflowStore)

const isHtmlMode = ref(viewMode.value === 'html')
watch(viewMode, (v) => { isHtmlMode.value = v === 'html' })

const props = defineProps<{
  notesVisible?: boolean
  chatVisible?: boolean
  fullTranslationVisible?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-notes-visibility'): void
  (e: 'toggle-chat-visibility'): void
  (e: 'toggle-full-translation'): void
  (e: 'start-full-translation'): void
  (e: 'adjust-font-size', delta: number): void
}>()

const pdfStore = usePdfStore()
const isCurrentHtmlRegenerating = computed(() => regeneratingPdfId.value === pdfStore.activeReaderId)

const pageInput = ref('')
const scaleInput = ref(String(pdfStore.scalePercent))
const showRoadmap = ref(false)

function handlePageInput() {
  const page = parseInt(pageInput.value)
  if (!isNaN(page)) {
    pdfStore.goToPage(page)
  }
  pageInput.value = ''
}

function applyScaleInput() {
  const value = parseFloat(scaleInput.value)
  if (isNaN(value)) {
    scaleInput.value = String(pdfStore.scalePercent)
    return
  }
  pdfStore.setScalePercent(value)
  scaleInput.value = String(pdfStore.scalePercent)
}

watch(
  () => pdfStore.scalePercent,
  (val) => {
    scaleInput.value = String(val)
  }
)

/** PDF 模式下点击 HTML 按钮 */
function handleHtmlClick() {
  if (!pdfStore.activeReaderId) return
  void htmlReflowStore.requestHtml(pdfStore.activeReaderId)
}

/** HTML 模式下切回 PDF */
function switchToPdf() {
  htmlReflowStore.viewMode = 'pdf'
}

/** HTML 模式下重新生成 */
function handleRegenerate() {
  if (!pdfStore.activeReaderId) return
  void htmlReflowStore.regenerateHtml(pdfStore.activeReaderId)
}

const bilingualOptions: { value: BilingualMode; label: string }[] = [
  { value: 'english', label: 'EN' },
  { value: 'chinese', label: '中' },
  { value: 'both', label: '双' },
]

</script>

<template>
  <div class="relative">
    <div class="pdf-toolbar">
      <!-- ===== PDF 模式专属：缩放 + 翻页 ===== -->
      <template v-if="!isHtmlMode">
        <div class="pdf-toolbar__group">
          <button @click="pdfStore.zoomOut" class="pdf-toolbar__icon-btn" :title="t('pdfToolbar.zoomOut')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
          </button>
          <div class="pdf-toolbar__field-group">
            <input
              v-model="scaleInput"
              type="number"
              min="50" max="300" step="1"
              @keyup.enter="applyScaleInput" @blur="applyScaleInput"
              class="pdf-toolbar__input pdf-toolbar__input--scale no-spinner"
            />
            <span class="pdf-toolbar__suffix">%</span>
          </div>
          <button @click="pdfStore.zoomIn" class="pdf-toolbar__icon-btn" :title="t('pdfToolbar.zoomIn')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
          </button>
        </div>

        <div class="pdf-toolbar__group">
          <button @click="pdfStore.prevPage" :disabled="pdfStore.currentPage <= 1" class="pdf-toolbar__icon-btn" :title="t('pdfToolbar.previousPage')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div class="pdf-toolbar__field-group">
            <input
              v-model="pageInput"
              type="text"
              :placeholder="String(pdfStore.currentPage)"
              @keyup.enter="handlePageInput"
              class="pdf-toolbar__input pdf-toolbar__input--page"
            />
            <span class="pdf-toolbar__suffix">/</span>
            <span class="pdf-toolbar__value">{{ pdfStore.totalPages || '-' }}</span>
          </div>
          <button @click="pdfStore.nextPage" :disabled="pdfStore.currentPage >= pdfStore.totalPages" class="pdf-toolbar__icon-btn" :title="t('pdfToolbar.nextPage')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </template>

      <!-- ===== HTML 模式专属：来源 + 双语 + 字号 ===== -->
      <template v-else>
        <div class="pdf-toolbar__group">
          <button
            v-for="opt in bilingualOptions"
            :key="opt.value"
            class="pdf-toolbar__toggle"
            :class="{ 'pdf-toolbar__toggle--active': bilingualMode === opt.value }"
            @click="htmlReflowStore.setBilingualMode(opt.value)"
            :title="`${opt.label} mode`"
          >
            {{ opt.label }}
          </button>
        </div>

        <div class="pdf-toolbar__group">
          <button class="pdf-toolbar__icon-btn" title="A-" @click="emit('adjust-font-size', -1)">
            <span class="text-xs font-semibold">A-</span>
          </button>
          <button class="pdf-toolbar__icon-btn" title="A+" @click="emit('adjust-font-size', 1)">
            <span class="text-xs font-semibold">A+</span>
          </button>
        </div>
      </template>

      <!-- ===== 共用右侧按钮区 ===== -->
      <div class="pdf-toolbar__group">
        <!-- 全文翻译（两个模式都有） -->
        <button
          @click="emit('start-full-translation')"
          class="pdf-toolbar__toggle"
          :class="{ 'pdf-toolbar__toggle--active': pdfStore.fullTranslationStatus === 'loading' }"
          :title="pdfStore.paragraphs.length === 0 ? t('pdfToolbar.paragraphsNotLoaded') : t('pdfToolbar.fullTranslation')"
          :disabled="pdfStore.fullTranslationStatus === 'loading' || pdfStore.paragraphs.length === 0"
        >
          <span class="flex items-center gap-1.5">
            {{ t('pdfToolbar.fullTranslation') }}
          </span>
        </button>

        <!-- PDF 模式：译文面板切换 -->
        <button
          v-if="!isHtmlMode"
          @click="emit('toggle-full-translation')"
          class="pdf-toolbar__toggle pdf-toolbar__toggle--icon"
          :class="{ 'pdf-toolbar__toggle--active': props.fullTranslationVisible }"
          :title="props.fullTranslationVisible ? '隐藏译文面板' : '显示译文面板'"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
          </svg>
        </button>

        <!-- ===== 视图切换按钮：PDF ↔ HTML ===== -->
        <template v-if="isHtmlMode">
          <!-- HTML 模式 → 显示 PDF 切换按钮 -->
          <button
            @click="switchToPdf"
            class="pdf-toolbar__toggle"
            :title="t('pdfToolbar.switchToPdf')"
          >
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              PDF
            </span>
          </button>
          <!-- 重新生成 HTML 按钮 -->
          <button
            @click="handleRegenerate"
            class="pdf-toolbar__toggle"
            :disabled="isCurrentHtmlRegenerating"
            :title="t('pdfToolbar.htmlRegenerate')"
          >
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4" :class="{ 'animate-spin': isCurrentHtmlRegenerating }" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {{ t('pdfToolbar.htmlRegenerate') }}
            </span>
          </button>
        </template>
        <template v-else>
          <!-- PDF 模式 → 显示 HTML 切换按钮 -->
          <button
            @click="handleHtmlClick"
            class="pdf-toolbar__toggle"
            :title="t('pdfToolbar.htmlView')"
          >
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
              HTML
            </span>
          </button>
        </template>

        <button
          @click="showRoadmap = !showRoadmap"
          class="pdf-toolbar__toggle"
          :class="{ 'pdf-toolbar__toggle--active': showRoadmap }"
          :title="t('pdfToolbar.roadmap')"
        >
          <span class="flex items-center gap-1.5">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
            {{ t('pdfToolbar.roadmap') }}
          </span>
        </button>

        <button
          @click="emit('toggle-notes-visibility')"
          class="pdf-toolbar__toggle pdf-toolbar__toggle--icon"
          :class="{ 'pdf-toolbar__toggle--active': props.notesVisible }"
          :title="props.notesVisible ? t('pdfToolbar.hideNotes') : t('pdfToolbar.showNotes')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>

        <button
          @click="emit('toggle-chat-visibility')"
          class="pdf-toolbar__toggle pdf-toolbar__toggle--icon"
          :class="{ 'pdf-toolbar__toggle--active': props.chatVisible }"
          :title="props.chatVisible ? t('pdfToolbar.hideChat') : t('pdfToolbar.showChat')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <RoadmapTab v-if="showRoadmap" @close="showRoadmap = false" />
    </Teleport>
  </div>
</template>

<style scoped>
.pdf-toolbar {
  height: var(--toolbar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4);
  background: var(--c-bg-elevated);
  border-bottom: var(--border-width) solid var(--c-border-light);
  backdrop-filter: blur(10px);
}

.pdf-toolbar__group {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
}

.pdf-toolbar__icon-btn,
.pdf-toolbar__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--btn-height-md);
  border: var(--border-width) solid transparent;
  border-radius: var(--btn-radius);
  padding: 0 var(--btn-padding-x);
  font-size: var(--btn-font-size);
  font-weight: var(--font-semibold);
  color: var(--c-btn-text);
  box-shadow: var(--interactive-shadow-rest);
  transform: translateY(0);
  transition: background-color var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default),
              box-shadow var(--duration-fast) var(--ease-default),
              transform var(--duration-fast) var(--ease-default),
              opacity var(--duration-fast) var(--ease-default);
}

.pdf-toolbar__icon-btn {
  width: var(--btn-height-md);
  padding: 0;
}

.pdf-toolbar__icon-btn:hover,
.pdf-toolbar__toggle:hover {
  background: var(--c-btn-bg-hover);
  border-color: var(--c-btn-border-hover);
  color: var(--c-btn-text-hover);
  box-shadow: var(--interactive-shadow-hover);
  transform: translateY(var(--interactive-hover-y));
}

.pdf-toolbar__icon-btn:disabled,
.pdf-toolbar__toggle:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}

.pdf-toolbar__icon-btn:active:not(:disabled),
.pdf-toolbar__toggle:active:not(:disabled) {
  box-shadow: var(--interactive-shadow-active);
  transform: translateY(0);
}

.pdf-toolbar__toggle--error {
  color: var(--c-error);
  border-color: var(--c-error);
}
.pdf-toolbar__toggle--error:hover {
  background: var(--c-error-bg);
}

.pdf-toolbar__toggle--active {
  background: var(--c-btn-icon-active-bg);
  border-color: var(--c-btn-icon-active-border);
  color: var(--c-btn-icon-active-text);
  box-shadow: var(--shadow-btn-icon-active);
}

.pdf-toolbar__toggle--icon {
  width: var(--btn-height-md);
  padding: 0;
}

.pdf-toolbar__icon-btn > svg,
.pdf-toolbar__toggle > svg,
.pdf-toolbar__toggle > span > svg {
  width: var(--btn-icon-size);
  height: var(--btn-icon-size);
}

.pdf-toolbar__field-group {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.pdf-toolbar__input {
  border: var(--border-width) solid var(--c-border-input);
  border-radius: var(--radius-lg);
  background: var(--c-bg-input);
  color: var(--c-text-primary);
  text-align: center;
  font-size: var(--popup-text-size);
  line-height: var(--leading-tight);
  padding: 4px var(--space-2);
}

.pdf-toolbar__input:focus {
  outline: none;
  border-color: var(--c-border-focus);
  box-shadow: var(--ring-focus);
}

.pdf-toolbar__input--scale {
  width: 56px;
}

.pdf-toolbar__input--page {
  width: 40px;
}

.pdf-toolbar__suffix,
.pdf-toolbar__value {
  font-size: var(--popup-text-size);
  color: var(--c-text-tertiary);
}

.pdf-toolbar__divider {
  width: var(--border-width);
  height: var(--space-5);
  margin: 0 var(--space-1);
  background: var(--c-border-divider);
}

/* Animation for loading spinner */
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
