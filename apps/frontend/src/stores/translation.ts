import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TranslationPanelInstance } from '../types'
import { useLibraryStore } from './library'
import { aiApi } from '../api'
import { broadcastSync } from '../utils/broadcast'
import { STORES, dbPut } from '../utils/db'

export const useTranslationStore = defineStore('translation', () => {
  const libraryStore = useLibraryStore()

  // ---------------------- 状态（State） ----------------------

  // 划词翻译/快速翻译状态
  const showTextTranslation = ref(false)
  const isTextTranslating = ref(false)
  const textTranslationResult = ref('')
  const textTranslationOriginal = ref('')

  // 划词翻译面板的位置
  const textPanelPosition = ref<{ x: number; y: number }>({ x: 0, y: 0 })

  // 多窗口翻译面板列表
  const translationPanels = ref<TranslationPanelInstance[]>([])

  // 段落翻译结果缓存（paragraphId -> translation）
  const translatedParagraphsCache = ref<Map<string, string>>(new Map())

  // 段落悬浮联动状态
  const hoveredParagraphId = ref<string | null>(null)

  function setHoveredParagraph(id: string | null) {
    hoveredParagraphId.value = id
  }

  // ---------------------- 动作（Actions） ----------------------

  // 翻译文本 (划词翻译)
  async function translateText(text: string, forceRefresh = false) {
    showTextTranslation.value = true
    isTextTranslating.value = true
    textTranslationOriginal.value = text

    if (!forceRefresh && textTranslationResult.value && text === textTranslationOriginal.value) {
      isTextTranslating.value = false
      return
    }

    textTranslationResult.value = ''

    try {
      const pdfId = libraryStore.currentDocumentId
      const response = await aiApi.translateText(text, pdfId || undefined)

      if (response && response.translatedText) {
        textTranslationResult.value = response.translatedText
      } else {
        textTranslationResult.value = "未能获取翻译结果"
      }
    } catch (error) {
      console.error('Translation failed:', error)
      textTranslationResult.value = "翻译请求失败，请稍后重试。"
    } finally {
      isTextTranslating.value = false
    }
  }

  function closeTextTranslation() {
    showTextTranslation.value = false
  }

  // ---------------------- 翻译面板管理 ----------------------

  function openTranslationPanel(paragraphId: string, position: { x: number; y: number }, originalText: string) {
    const existingPanel = translationPanels.value.find(p => p.paragraphId === paragraphId)
    if (existingPanel) {
      const index = translationPanels.value.indexOf(existingPanel)
      translationPanels.value.splice(index, 1)
      translationPanels.value.push(existingPanel)
      return existingPanel
    }

    const newPanel: TranslationPanelInstance = {
      id: `tp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      paragraphId,
      position,
      size: { width: 420, height: 280 },
      translation: '',
      isLoading: true,
      originalText,
      snapMode: 'none',
      snapTargetParagraphId: null
    }

    translationPanels.value.push(newPanel)
    return newPanel
  }

  function closeTranslationPanelById(panelId: string) {
    const index = translationPanels.value.findIndex(p => p.id === panelId)
    if (index !== -1) {
      translationPanels.value.splice(index, 1)
    }
  }

  function updateTextPanelPosition(position: { x: number; y: number }) {
    textPanelPosition.value = position
  }

  function updatePanelPosition(panelId: string, position: { x: number; y: number }) {
    const panel = translationPanels.value.find(p => p.id === panelId)
    if (panel) {
      panel.position = position
    }
  }

  function updatePanelSize(panelId: string, size: { width: number; height: number }) {
    const panel = translationPanels.value.find(p => p.id === panelId)
    if (panel) {
      panel.size = size
    }
  }

  function setPanelSnapMode(panelId: string, mode: 'none' | 'paragraph', targetParagraphId?: string) {
    const panel = translationPanels.value.find(p => p.id === panelId)
    if (panel) {
      panel.snapMode = mode
      panel.snapTargetParagraphId = targetParagraphId || null
    }
  }

  function setPanelLoading(panelId: string, loading: boolean) {
    const panel = translationPanels.value.find(p => p.id === panelId)
    if (panel) {
      panel.isLoading = loading
    }
  }

  function setPanelTranslation(panelId: string, translation: string) {
    const panel = translationPanels.value.find(p => p.id === panelId)
    if (panel) {
      panel.translation = translation
    }
  }

  function bringPanelToFront(panelId: string) {
    const index = translationPanels.value.findIndex(p => p.id === panelId)
    if (index !== -1 && index !== translationPanels.value.length - 1) {
      const panel = translationPanels.value.splice(index, 1)[0]
      if (panel) {
        translationPanels.value.push(panel)
      }
    }
  }

  function closeAllPanels() {
    translationPanels.value = []
    showTextTranslation.value = false
  }

  function setTranslatedParagraph(paragraphId: string, translation: string, pdfId?: string | null) {
    if (!translation.trim()) return

    const next = new Map(translatedParagraphsCache.value)
    next.set(paragraphId, translation)
    translatedParagraphsCache.value = next

    translationPanels.value.forEach((panel) => {
      if (panel.paragraphId === paragraphId) {
        panel.translation = translation
        panel.isLoading = false
      }
    })

    // 持久化到 IndexedDB
    const effectivePdfId = pdfId ?? libraryStore.currentDocumentId
    if (effectivePdfId) {
      dbPut(STORES.TRANSLATIONS, { id: paragraphId, pdfId: effectivePdfId, translation }).catch(console.warn)
    }
  }

  function syncTranslatedParagraph(paragraphId: string, translation: string, pdfId?: string | null) {
    if (!translation.trim()) return

    setTranslatedParagraph(paragraphId, translation, pdfId ?? libraryStore.currentDocumentId)
    broadcastSync('SYNC_TRANSLATION', {
      pdfId: pdfId ?? libraryStore.currentDocumentId ?? null,
      paragraphId,
      translation,
    })
  }

  function clearCache() {
    textTranslationResult.value = ''
    textTranslationOriginal.value = ''
    closeAllPanels()
    translatedParagraphsCache.value = new Map()
    // 注意：Vue Query 缓存由 queryClient.clear() 统一处理
  }

  return {
    textPanelPosition,
    translationPanels,
    translatedParagraphsCache,
    showTextTranslation,
    isTextTranslating,
    textTranslationResult,
    textTranslationOriginal,
    translateText,
    closeTextTranslation,
    openTranslationPanel,
    closeTranslationPanelById,
    updateTextPanelPosition,
    updatePanelPosition,
    updatePanelSize,
    setPanelSnapMode,
    setPanelLoading,
    setPanelTranslation,
    bringPanelToFront,
    closeAllPanels,
    setTranslatedParagraph,
    syncTranslatedParagraph,
    clearCache,
    hoveredParagraphId,
    setHoveredParagraph
  }
})
