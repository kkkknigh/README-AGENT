<script setup lang="ts">
import { ref } from 'vue'
import { usePdfStore, type Highlight } from '../../stores/pdf'
import { useTranslationStore } from '../../stores/translation'
import { useSelectText } from '../../composables/useSelectText'
import { useUpdateHighlightMutation, useDeleteHighlightMutation, useCreateHighlightMutation } from '../../composables/queries/useHighlightQueries'
import { useNotesUiStore } from '../../stores/notes-ui'
import { trackEvent } from '../../utils/tracking'

const props = defineProps<{
  position: { x: number; y: number }
  text: string
  mode?: 'selection' | 'highlight'
  highlight?: Highlight | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const pdfStore = usePdfStore()
const translateStore = useTranslationStore()
const dragStore = useSelectText()
const notesUiStore = useNotesUiStore()

const updateHighlightMutation = useUpdateHighlightMutation()
const deleteHighlightMutation = useDeleteHighlightMutation()
const createHighlightMutation = useCreateHighlightMutation()

const isColorPickerOpen = ref(false)
const customColor = ref('#000000')
const isCustomColorSet = ref(false)

const colorOptions = [
  { label: '亮黄', value: '#F6E05E' },
  { label: '薄绿', value: '#9AE6B4' },
  { label: '天蓝', value: '#63B3ED' },
  { label: '柔粉', value: '#FBB6CE' },
  { label: '橙棕', value: '#F6AD55' },
]

function handleCustomColorChange(event: Event) {
  const input = event.target as HTMLInputElement
  const color = input.value
  customColor.value = color
  isCustomColorSet.value = true
  handleColorSelect(color)
}

async function handleTranslate() {
  // 埋点：word_explain_clicked
  trackEvent('word_explain_clicked', {
    selected_text: props.text.slice(0, 200),
    selected_text_length: props.text.length,
    module_name: 'ai_panel',
  })

  dragStore.resetDrag()
  translateStore.updateTextPanelPosition({
    x: props.position.x,
    y: props.position.y + 40,
  })
  await translateStore.translateText(props.text)
  emit('close')
}

function handleAddToNote() {
  // 埋点：word_explain_saved（保存解释到笔记）
  // trackEvent('word_explain_saved', { save_target: 'note', module_name: 'ai_panel' })

  notesUiStore.requestNewNote({ title: props.text })
  emit('close')
}

function handleHighlight() {
  if (props.mode === 'highlight' && props.highlight) {
    if (pdfStore.activeReaderId) {
      deleteHighlightMutation.mutate({ id: props.highlight.id, pdfId: pdfStore.activeReaderId })
    }
  } else {
    if (pdfStore.activeReaderId && pdfStore.selectionInfo && pdfStore.selectedText) {
      const pageIndex = pdfStore.selectionInfo.page - 1
      const pageSize = pdfStore.pageSizesArray
        ? pdfStore.pageSizesArray[pageIndex]
        : pdfStore.pageSizesConstant

      createHighlightMutation.mutate({
        pdfId: pdfStore.activeReaderId,
        page: pdfStore.selectionInfo.page,
        rects: pdfStore.selectionInfo.rects,
        text: pdfStore.selectedText,
        color: pdfStore.highlightColor,
        pageWidth: pageSize?.width ?? 0,
        pageHeight: pageSize?.height ?? 0,
      })
    }
    pdfStore.clearSelection()
  }
  emit('close')
}

function toggleColorPicker(event: MouseEvent) {
  event.stopPropagation()
  if (!isColorPickerOpen.value && props.mode === 'highlight' && props.highlight) {
    customColor.value = props.highlight.color
    isCustomColorSet.value = true
  }
  isColorPickerOpen.value = !isColorPickerOpen.value
}

function handleColorSelect(color: string) {
  if (props.mode === 'highlight' && props.highlight) {
    if (pdfStore.activeReaderId) {
      updateHighlightMutation.mutate({ id: props.highlight.id, color, pdfId: pdfStore.activeReaderId })
    }
  } else {
    pdfStore.setHighlightColor(color)
  }
  isColorPickerOpen.value = false
}
</script>

<template>
  <div
    class="fixed z-50 -translate-x-1/2 -translate-y-full transform"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
    }"
  >
    <div class="popup-surface popup-surface--floating relative py-1">
      <div class="flex items-center divide-x divide-gray-200 dark:divide-gray-700">
        <button
          @click="handleTranslate"
          class="selection-action"
          :class="{ 'selection-action--active': translateStore.showTextTranslation }"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
          </svg>
          翻译
        </button>

        <button @click="handleHighlight" class="selection-action">
          <svg v-if="mode !== 'highlight'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span>{{ mode === 'highlight' ? '取消高亮' : '高亮' }}</span>
        </button>

        <div class="relative">
          <button
            @click.stop="toggleColorPicker"
            class="selection-color-trigger"
            :title="mode === 'highlight' ? '更改高亮颜色' : '选择高亮颜色'"
          >
            <span
              class="block h-5 w-5 rounded-full border border-black/10 shadow-sm dark:border-white/20"
              :style="{ backgroundColor: mode === 'highlight' && highlight ? highlight.color : pdfStore.highlightColor }"
            ></span>
          </button>

          <div
            v-if="isColorPickerOpen"
            class="popup-surface popup-surface--floating selection-color-panel absolute left-1/2 z-10 mt-2 flex -translate-x-1/2 gap-2"
            @click.stop
          >
            <button
              v-for="option in colorOptions"
              :key="option.value"
              @click="handleColorSelect(option.value)"
              class="selection-color-chip"
              :style="{ backgroundColor: option.value }"
              :title="option.label"
            ></button>

            <div class="selection-color-chip relative overflow-hidden" title="自定义颜色">
              <div
                class="absolute inset-0 h-full w-full"
                :style="{
                  background: isCustomColorSet
                    ? customColor
                    : 'conic-gradient(from 180deg at 50% 50%, #FF0000 0deg, #FFFF00 60deg, #00FF00 120deg, #00FFFF 180deg, #0000FF 240deg, #FF00FF 300deg, #FF0000 360deg)',
                }"
              ></div>
              <input
                v-model="customColor"
                type="color"
                class="absolute inset-0 h-full w-full cursor-pointer border-none p-0 opacity-0"
                @change="handleCustomColorChange"
              />
            </div>
          </div>
        </div>

        <button @click="handleAddToNote" class="selection-action">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          笔记
        </button>
      </div>

      <div class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full transform">
        <div class="tooltip-arrow h-3 w-3 rotate-45 border-r border-b border-black/6 bg-white dark:border-gray-700 dark:bg-[#1e1e1e]"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.selection-action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: var(--popup-input-padding-y) var(--popup-input-padding-x);
  font-size: var(--popup-text-size);
  line-height: 1;
  color: var(--c-text-secondary);
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default);
}

.selection-action:hover,
.selection-color-trigger:hover {
  background: var(--c-bg-hover);
}

.selection-action--active {
  color: var(--c-accent);
}

.selection-color-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--popup-input-padding-y);
  transition: background-color var(--duration-fast) var(--ease-default);
}

.selection-color-panel {
  padding: var(--popup-input-padding-y) var(--popup-input-padding-x);
  border-radius: var(--popup-radius);
}

.selection-color-chip {
  height: 24px;
  width: 24px;
  border-radius: var(--radius-full);
  border: var(--border-width) solid rgba(0, 0, 0, 0.1);
  box-shadow: var(--shadow-sm);
}

.selection-color-chip:focus-visible {
  outline: 2px solid var(--c-border-focus);
  outline-offset: 2px;
}

.tooltip-arrow {
  margin-top: -6px;
}
</style>
