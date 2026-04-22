<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { aiApi } from '../../api'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'
import { usePdfStore } from '../../stores/pdf'
import { useTranslationStore } from '../../stores/translation'

const props = defineProps<{
  panelId: string
  paragraphId: string
  translation: string
  isLoading: boolean
  fontSize: number
}>()

const pdfStore = usePdfStore()
const translationStore = useTranslationStore()
const { renderMarkdown } = useMarkdownRenderer()

const displayTranslation = computed(() => props.translation || '暂无翻译')

async function loadParagraphTranslation() {
  const cached = translationStore.translatedParagraphsCache.get(props.paragraphId)
  if (typeof cached === 'string' && cached.trim()) {
    translationStore.setPanelTranslation(props.panelId, cached)
    translationStore.setPanelLoading(props.panelId, false)
    return
  }

  if (!pdfStore.activeReaderId) {
    translationStore.setPanelLoading(props.panelId, false)
    return
  }

  const paragraph = pdfStore.paragraphs.find(item => item.id === props.paragraphId)
  if (!paragraph?.content?.trim()) {
    translationStore.setPanelTranslation(props.panelId, '未找到段落内容，无法翻译。')
    translationStore.setPanelLoading(props.panelId, false)
    return
  }

  translationStore.setPanelLoading(props.panelId, true)
  try {
    const result = await aiApi.translateParagraph(pdfStore.activeReaderId, props.paragraphId, paragraph.content)
    const nextTranslation = typeof result.translation === 'string' && result.translation.trim()
      ? result.translation
      : '未能获取翻译结果，请稍后重试。'

    translationStore.setPanelTranslation(props.panelId, nextTranslation)
    if (typeof result.translation === 'string' && result.translation.trim()) {
      translationStore.syncTranslatedParagraph(props.paragraphId, result.translation, pdfStore.activeReaderId)
      pdfStore.applyParagraphTranslation(pdfStore.activeReaderId, props.paragraphId, result.translation)
    }
  } catch (error) {
    console.error('Failed to translate paragraph:', error)
    translationStore.setPanelTranslation(props.panelId, '翻译请求失败，请稍后重试。')
  } finally {
    translationStore.setPanelLoading(props.panelId, false)
  }
}

onMounted(() => {
  if (props.translation.trim()) {
    translationStore.setPanelLoading(props.panelId, false)
    return
  }
  void loadParagraphTranslation()
})
</script>

<template>
  <div class="panel-content popup-body popup-scroll flex-1 overflow-y-auto cursor-auto select-text" @mousedown.stop>
    <div v-if="isLoading" class="flex flex-col items-center justify-center py-6">
      <div class="popup-loading-spinner mb-2"></div>
      <span class="popup-text-muted">翻译中...</span>
    </div>

    <div
      v-else
      class="translation-text popup-text markdown-body prose prose-sm max-w-none"
      :data-panel-content="panelId"
      :style="{ fontSize: fontSize + 'px' }"
      v-html="renderMarkdown(displayTranslation)"
    ></div>
  </div>
</template>

<style scoped>
</style>

