<script setup lang="ts">
/*
----------------------------------------------------------------------
                            翻译面板
----------------------------------------------------------------------
*/
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { usePdfStore } from '../../stores/pdf'
import { useTranslationStore } from '../../stores/translation'
import TranslationPanelItem from './TranslationPanelItem.vue'
import { useDraggableWindow } from '../../composables/useDraggableWindow'
import { useResizableWindow } from '../../composables/useResizableWindow'
import type { TranslationPanelInstance } from '../../types'
import { clamp } from '@vueuse/core'
import { getPageSize } from '../../utils/PdfHelper'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'
import { aiApi } from '../../api'
import { trackEvent } from '../../utils/tracking'

const pdfStore = usePdfStore()
const translationStore = useTranslationStore()
const { renderMarkdown } = useMarkdownRenderer()

// 常量定义
const TEXT_PANEL_ID = 'text-selection-panel'
const MIN_WIDTH = 280
const MAX_WIDTH = 900
const MIN_HEIGHT = 150
const MAX_HEIGHT = 600
const PARAGRAPH_SNAP_THRESHOLD = 150
const SNAP_MIN_HEIGHT = 40
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 24

// 划词翻译面板的本地状态（Store 不持有尺寸）
const textPanelSize = ref({ width: 320, height: 280 })

// 拖拽与缩放状态
const draggingPanelId = ref<string | null>(null)
const resizingPanelId = ref<string | null>(null)

// 吸附相关状态
const isNearSnapTarget = ref(false)
const snapTargetRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
const snapTargetParagraphId = ref<string | null>(null)

// 字体大小映射
const fontSizeDeltaMap: Record<string, number> = {}

// 吸附模式下自适应字体大小（覆盖 getFontSize）
const autoFitFontSizeMap = ref<Record<string, number>>({})

// 复制状态
const copiedPanelId = ref<string | null>(null)

function getParagraphScreenRect(paragraph: { page: number; bbox: { x0: number; y0: number; width: number; height: number } }) {
  const pageElement = document.querySelector(`.pdf-page[data-page="${paragraph.page}"]`) as HTMLElement | null
  if (!pageElement) return null

  const pageRect = pageElement.getBoundingClientRect()
  const originalPageSize = getPageSize(paragraph.page, pdfStore.pageSizesConstant, pdfStore.pageSizesArray)
  const scaleX = pageRect.width / originalPageSize.width
  const scaleY = pageRect.height / originalPageSize.height

  return {
    left: pageRect.left + paragraph.bbox.x0 * scaleX,
    top: pageRect.top + paragraph.bbox.y0 * scaleY,
    width: paragraph.bbox.width * scaleX,
    height: paragraph.bbox.height * scaleY,
    pageElement,
  }
}

function getParagraphMarkerRect(paragraphId: string) {
  const markerElement = document.querySelector(`[data-paragraph-id="${paragraphId}"]`) as HTMLElement | null
  if (!markerElement) return null

  const markerRect = markerElement.getBoundingClientRect()
  return {
    left: markerRect.left,
    top: markerRect.top,
    width: markerRect.width,
    height: markerRect.height,
  }
}

function getParagraphSnapRect(
  paragraph: { id: string; page: number; bbox: { x0: number; y0: number; width: number; height: number } }
) {
  const bboxRect = getParagraphScreenRect(paragraph)
  const markerRect = getParagraphMarkerRect(paragraph.id)

  if (bboxRect) return bboxRect

  if (markerRect) {
    return {
      left: markerRect.left - 12,
      top: markerRect.top - 6,
      width: Math.max(markerRect.width + 24, 40),
      height: Math.max(markerRect.height + 12, 24),
      pageElement: null
    }
  }

  return null
}

// ===========================================
// 计算属性：合并显示所有面板
// ===========================================
const visiblePanels = computed(() => {
  const panels: Array<TranslationPanelInstance & { isTextPanel?: boolean }> =
    translationStore.translationPanels.map(p => ({ ...p, isTextPanel: false }))
  
  // 2. 如果划词翻译开启，追加划词翻译面板
  if (translationStore.showTextTranslation) {
    panels.push({
      id: TEXT_PANEL_ID,
      paragraphId: '', // 划词翻译没有段落 ID
      position: translationStore.textPanelPosition,
      size: textPanelSize.value,
      translation: translationStore.textTranslationResult || (translationStore.isTextTranslating ? '' : '暂无翻译'),
      isLoading: translationStore.isTextTranslating,
      originalText: '',
      snapMode: 'none',
      snapTargetParagraphId: null,
      isTextPanel: true
    })
  }
  
  return panels
})

// 埋点：翻译结果面板被查看
const _viewedPanels = new Set<string>()
const _panelOpenTimes = new Map<string, number>()
watch(visiblePanels, (panels) => {
  for (const panel of panels) {
    if (!_panelOpenTimes.has(panel.id)) {
      _panelOpenTimes.set(panel.id, Date.now())
    }
    if (!panel.isLoading && panel.translation && !_viewedPanels.has(panel.id)) {
      _viewedPanels.add(panel.id)
      const openTime = _panelOpenTimes.get(panel.id) || Date.now()
      const viewDuration = Date.now() - openTime
      const eventName = panel.id === TEXT_PANEL_ID ? 'word_explain_result_viewed' : 'paragraph_translate_result_viewed'
      trackEvent(eventName, {
        view_duration_ms: viewDuration,
        module_name: 'ai_panel',
      })
    }
  }
}, { deep: true })

// ===========================================
// 辅助功能
// ===========================================

function getFontSize(panelId: string): number {
  // 吸附模式下使用自适应字体大小
  const autoSize = autoFitFontSizeMap.value[panelId]
  if (autoSize) {
    const delta = fontSizeDeltaMap[panelId] || 0
    return clamp(autoSize + delta, MIN_FONT_SIZE, MAX_FONT_SIZE)
  }
  const baseSize = Math.round(10 * clamp(pdfStore.scale || 1, 0.85, 1.35))
  const delta = fontSizeDeltaMap[panelId] || 0
  return clamp(baseSize + delta, MIN_FONT_SIZE, MAX_FONT_SIZE)
}

// 自适应字体：二分法找到刚好填满内容区的字号
function fitFontSizeForPanel(panelId: string) {
  const contentEl = document.querySelector(`[data-panel-content="${panelId}"]`) as HTMLElement | null
  if (!contentEl) return

  const container = contentEl.parentElement
  if (!container) return

  // 临时禁止滚动，确保 clientHeight 稳定
  const prevOverflow = container.style.overflow
  container.style.overflow = 'hidden'

  const availableHeight = container.clientHeight
  if (availableHeight <= 0) {
    container.style.overflow = prevOverflow
    return
  }

  let lo = MIN_FONT_SIZE
  let hi = MAX_FONT_SIZE
  let best = lo

  // 先清除手动 delta，纯粹计算自适应基准
  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2)
    contentEl.style.fontSize = mid + 'px'
    if (contentEl.scrollHeight <= availableHeight) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  contentEl.style.fontSize = ''
  container.style.overflow = prevOverflow
  autoFitFontSizeMap.value[panelId] = best
}

// 对所有吸附面板执行自适应
function fitAllSnappedPanels() {
  translationStore.translationPanels.forEach(panel => {
    if (panel.snapMode === 'paragraph') {
      fitFontSizeForPanel(panel.id)
    }
  })
}

const debouncedFitAll = useDebounceFn(fitAllSnappedPanels, 50)

function increaseFontSize(panelId: string) {
  const nextDelta = (fontSizeDeltaMap[panelId] || 0) + 1
  fontSizeDeltaMap[panelId] = nextDelta
}

function decreaseFontSize(panelId: string) {
  const nextDelta = (fontSizeDeltaMap[panelId] || 0) - 1
  fontSizeDeltaMap[panelId] = nextDelta
}

async function copyTranslation(panel: any) {
  if (!panel.translation) return
  try {
    await navigator.clipboard.writeText(panel.translation)
    copiedPanelId.value = panel.id

    // 埋点：paragraph_translate_copied / word_explain_copied
    const eventName = panel.id === TEXT_PANEL_ID ? 'word_explain_copied' : 'paragraph_translate_copied'
    trackEvent(eventName, {
      copy_length: panel.translation.length,
      module_name: 'ai_panel',
    })
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

function closePanel(panelId: string) {
  if (panelId === TEXT_PANEL_ID) {
    translationStore.closeTextTranslation()
  } else {
    translationStore.closeTranslationPanelById(panelId)
  }
}

async function retranslate(panel: any) {
  if (panel.isTextPanel) {
    // 划词翻译重新翻译
    const originalText = translationStore.textTranslationOriginal
    if (!originalText) return
    await translationStore.translateText(originalText, true)
  } else {
    // 段落翻译重新翻译
    if (!panel.paragraphId) return
    if (!pdfStore.activeReaderId) return
    const paragraph = pdfStore.paragraphs.find(item => item.id === panel.paragraphId)
    if (!paragraph?.content?.trim()) {
      translationStore.setPanelTranslation(panel.id, '未找到段落内容，无法翻译。')
      return
    }

    translationStore.setPanelLoading(panel.id, true)
    try {
      const result = await aiApi.translateParagraph(pdfStore.activeReaderId, panel.paragraphId, paragraph.content)
      const nextTranslation = typeof result.translation === 'string' && result.translation.trim()
        ? result.translation
        : '未能获取翻译结果，请稍后重试。'

      translationStore.setPanelTranslation(panel.id, nextTranslation)

      if (typeof result.translation === 'string' && result.translation.trim()) {
        translationStore.syncTranslatedParagraph(panel.paragraphId, result.translation, pdfStore.activeReaderId)
        pdfStore.applyParagraphTranslation(pdfStore.activeReaderId, panel.paragraphId, result.translation)
      }
    } catch (error) {
      console.error('Failed to force translate paragraph:', error)
      translationStore.setPanelTranslation(panel.id, '翻译请求失败，请稍后重试。')
    } finally {
      translationStore.setPanelLoading(panel.id, false)
    }
  }
}

function focusPanel(panelId: string) {
  if (panelId !== TEXT_PANEL_ID) {
    translationStore.bringPanelToFront(panelId)
  }
  // Text panel stays implicitly on top due to render order in computed
}

function handlePanelWheel(event: WheelEvent) {
  if (!(event.ctrlKey || event.metaKey)) return

  event.preventDefault()
  event.stopPropagation()
  window.dispatchEvent(new CustomEvent('reader-zoom-wheel', {
    detail: {
      deltaY: event.deltaY,
      clientX: event.clientX,
      clientY: event.clientY,
    }
  }))
}

// ===========================================
// ===========================================
// 拖拽逻辑 (Draggable)

// 计算吸附位置
function calculateParagraphSnapPosition(paragraphId: string) {
  const paragraph = pdfStore.paragraphs.find(p => p.id === paragraphId)
  if (!paragraph) return null

  return getParagraphSnapRect(paragraph)
}

function getAllParagraphRects() {
  const results: Array<{ id: string; rect: { left: number; top: number; width: number; height: number }; page: number }> = []

  pdfStore.paragraphs.forEach(paragraph => {
    const rect = getParagraphSnapRect(paragraph)
    if (!rect) return

    results.push({
      id: paragraph.id,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      page: paragraph.page
    })
  })
  
  return results
}

function clampToViewport(position: { x: number; y: number }, size: { width: number; height: number }) {
  const maxX = Math.max(0, window.innerWidth - size.width)
  const maxY = Math.max(0, window.innerHeight - size.height)
  return {
    x: clamp(position.x, 0, maxX),
    y: clamp(position.y, 0, maxY),
  }
}

function clampAllPanelsToViewport() {
  translationStore.updateTextPanelPosition(clampToViewport(translationStore.textPanelPosition, textPanelSize.value))

  translationStore.translationPanels.forEach((panel) => {
    if (panel.snapMode === 'paragraph') return
    translationStore.updatePanelPosition(panel.id, clampToViewport(panel.position, panel.size))
  })
}

const { startDrag: initDrag, setPosition: setDragPosition } = useDraggableWindow({
  onDrag: (newPos) => {
    if (!draggingPanelId.value) return
    const currentId = draggingPanelId.value

    // --- 1. 划词翻译面板处理 ---
    if (currentId === TEXT_PANEL_ID) {
      translationStore.updateTextPanelPosition(clampToViewport(newPos, textPanelSize.value))
      return
    }

    // --- 2. 段落翻译面板处理 ---
    const panel = translationStore.translationPanels.find(p => p.id === currentId)
    if (!panel) {
      console.warn(`Translation panel ${currentId} not found during drag`)
      return
    }
    
    if (panel.paragraphId) {
      const ownSnapRect = calculateParagraphSnapPosition(panel.paragraphId)
      if (ownSnapRect) {
        const panelCx = newPos.x + panel.size.width / 2
        const panelCy = newPos.y + panel.size.height / 2
        const ownCx = ownSnapRect.left + ownSnapRect.width / 2
        const ownCy = ownSnapRect.top + ownSnapRect.height / 2
        const ownDistance = Math.hypot(panelCx - ownCx, panelCy - ownCy)
        const insideOwnRect =
          panelCx >= ownSnapRect.left &&
          panelCx <= ownSnapRect.left + ownSnapRect.width &&
          panelCy >= ownSnapRect.top &&
          panelCy <= ownSnapRect.top + ownSnapRect.height

        if (insideOwnRect || ownDistance < PARAGRAPH_SNAP_THRESHOLD + 40) {
          isNearSnapTarget.value = true
          snapTargetParagraphId.value = panel.paragraphId
          snapTargetRect.value = {
            left: ownSnapRect.left,
            top: ownSnapRect.top,
            width: ownSnapRect.width,
            height: ownSnapRect.height
          }
        } else {
          isNearSnapTarget.value = false
          snapTargetParagraphId.value = null
          snapTargetRect.value = null
        }
      }
    }

    if (!(isNearSnapTarget.value && snapTargetRect.value)) {
      const allParagraphs = getAllParagraphRects()
      let nearest: { id: string; distance: number; rect: { left: number; top: number; width: number; height: number } } | null = null

      const panelCx = newPos.x + panel.size.width / 2
      const panelCy = newPos.y + panel.size.height / 2

      for (const p of allParagraphs) {
        const isInside =
          panelCx >= p.rect.left &&
          panelCx <= p.rect.left + p.rect.width &&
          panelCy >= p.rect.top &&
          panelCy <= p.rect.top + p.rect.height

        if (isInside) {
          nearest = { id: p.id, distance: 0, rect: p.rect }
          break
        }

        const markerCx = p.rect.left + p.rect.width / 2
        const markerCy = p.rect.top + p.rect.height / 2
        const dist = Math.hypot(panelCx - markerCx, panelCy - markerCy)

        if (dist < PARAGRAPH_SNAP_THRESHOLD) {
          if (!nearest || (nearest.distance > 0 && dist < nearest.distance)) {
            nearest = { id: p.id, distance: dist, rect: p.rect }
          }
        }
      }

      if (nearest) {
        isNearSnapTarget.value = true
        snapTargetParagraphId.value = nearest.id
        snapTargetRect.value = nearest.rect
      } else {
        isNearSnapTarget.value = false
        snapTargetParagraphId.value = null
        snapTargetRect.value = null
      }
    }

    translationStore.updatePanelPosition(currentId, clampToViewport(newPos, panel.size))
  },
  onDragEnd: () => {
    if (draggingPanelId.value && draggingPanelId.value !== TEXT_PANEL_ID) {
      if (isNearSnapTarget.value && snapTargetRect.value && snapTargetParagraphId.value) {
        translationStore.setPanelSnapMode(draggingPanelId.value, 'paragraph', snapTargetParagraphId.value)
        translationStore.updatePanelPosition(draggingPanelId.value, {
          x: snapTargetRect.value.left,
          y: snapTargetRect.value.top
        })
        translationStore.updatePanelSize(draggingPanelId.value, {
          width: clamp(snapTargetRect.value.width, MIN_WIDTH, MAX_WIDTH),
          height: clamp(snapTargetRect.value.height, SNAP_MIN_HEIGHT, MAX_HEIGHT)
        })
        const snapPanelId = draggingPanelId.value
        nextTick(() => fitFontSizeForPanel(snapPanelId))
      } else {
        delete autoFitFontSizeMap.value[draggingPanelId.value]
      }
    }

    draggingPanelId.value = null
    isNearSnapTarget.value = false
    snapTargetRect.value = null
    snapTargetParagraphId.value = null
  }
})

function startDrag(e: MouseEvent, panelId: string) {
  if (!(e.target as HTMLElement).closest('.panel-header')) return
  
  draggingPanelId.value = panelId
  
  if (panelId === TEXT_PANEL_ID) {
    setDragPosition(translationStore.textPanelPosition)
  } else {
    const panel = translationStore.translationPanels.find(p => p.id === panelId)
    if (!panel) {
      console.warn(`Translation panel ${panelId} not found when starting drag`)
      return
    }
    setDragPosition(panel.position)
    translationStore.setPanelSnapMode(panelId, 'none')
    delete autoFitFontSizeMap.value[panelId]
    translationStore.bringPanelToFront(panelId)
  }
  
  initDrag(e)
}

// ===========================================
// 缩放逻辑 (Resizable)
// ===========================================

const { startResize: initResize, setSize: setResizeSize } = useResizableWindow({
  minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH, minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT,
  onResize: ({ size, delta }) => {
    if (!resizingPanelId.value) return
    const id = resizingPanelId.value

    // 1. 划词翻译面板
    if (id === TEXT_PANEL_ID) {
      textPanelSize.value = size
      if (delta.x !== 0 || delta.y !== 0) {
        const curPos = translationStore.textPanelPosition
        translationStore.updateTextPanelPosition(clampToViewport({
          x: curPos.x + delta.x,
          y: curPos.y + delta.y
        }, size))
      }
      return
    }

    // 2. 段落翻译面板
    const panel = translationStore.translationPanels.find(p => p.id === id)
    if (!panel) {
      console.warn(`Translation panel ${id} not found during resize`)
      return
    }

    translationStore.updatePanelSize(id, size)
    if (delta.x !== 0 || delta.y !== 0) {
      translationStore.updatePanelPosition(id, clampToViewport({
        x: panel.position.x + delta.x,
        y: panel.position.y + delta.y
      }, size))
    }
  },
  onResizeEnd: () => {
    resizingPanelId.value = null
    clampAllPanelsToViewport()
  }
})

function startResize(e: MouseEvent, panelId: string, direction: string) {
  resizingPanelId.value = panelId
  
  if (panelId === TEXT_PANEL_ID) {
    setResizeSize(textPanelSize.value)
  } else {
    const panel = translationStore.translationPanels.find(p => p.id === panelId)
    if (!panel) {
      console.warn(`Translation panel ${panelId} not found when starting resize`)
      return
    }
    setResizeSize(panel.size)
    translationStore.bringPanelToFront(panelId)
  }
  
  initResize(e, direction)
}

// ===========================================
// PDF 滚动与更新逻辑
// ===========================================

// 滚动同步
function updateSnappedPanelPositions() {
  let hasSnapped = false
  translationStore.translationPanels.forEach(panel => {
    if (panel.snapMode === 'paragraph' && panel.snapTargetParagraphId) {
      const snapPos = calculateParagraphSnapPosition(panel.snapTargetParagraphId)
      if (snapPos) {
        translationStore.updatePanelPosition(panel.id, {
          x: snapPos.left,
          y: snapPos.top
        })
        translationStore.updatePanelSize(panel.id, {
          width: clamp(snapPos.width, MIN_WIDTH, MAX_WIDTH),
          height: clamp(snapPos.height, SNAP_MIN_HEIGHT, MAX_HEIGHT)
        })
        hasSnapped = true
      }
    }
  })
  if (hasSnapped) debouncedFitAll()
}

const debouncedUpdatePositions = useDebounceFn(updateSnappedPanelPositions, 16)
let scrollRafId: number | null = null

function onPdfScroll() {
  if (scrollRafId) cancelAnimationFrame(scrollRafId)
  scrollRafId = requestAnimationFrame(() => {
    updateSnappedPanelPositions()
    scrollRafId = null
  })
}

// 容器绑定监听
let pdfContainerRef: Element | null = null
let resizeObserver: ResizeObserver | null = null
let bindRetryCount = 0
const MAX_BIND_RETRIES = 10

function bindScrollListener() {
  if (pdfContainerRef) return
  pdfContainerRef = document.querySelector('.pdf-scroll-container')
  if (pdfContainerRef) {
    pdfContainerRef.addEventListener('scroll', onPdfScroll, { passive: true })
    resizeObserver = new ResizeObserver(() => debouncedUpdatePositions())
    resizeObserver.observe(pdfContainerRef)
    bindRetryCount = 0
  } else if (bindRetryCount < MAX_BIND_RETRIES) {
    bindRetryCount++
    setTimeout(bindScrollListener, 200)
  }
}

// PDF 缩放变化时重新计算吸附面板的位置和字体
watch(() => pdfStore.scale, () => {
  nextTick(() => {
    updateSnappedPanelPositions()
    clampAllPanelsToViewport()
    debouncedFitAll()
  })
})

watch(() => pdfStore.currentPdfUrl, (_url, oldUrl) => {
  if (pdfContainerRef) {
    pdfContainerRef.removeEventListener('scroll', onPdfScroll)
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    pdfContainerRef = null
  }
  bindRetryCount = 0
  if (oldUrl) {
    translationStore.closeAllPanels()
  }
  setTimeout(bindScrollListener, 200)
}, { immediate: true })

onMounted(() => {
  setTimeout(bindScrollListener, 200)
  window.addEventListener('resize', clampAllPanelsToViewport)
  nextTick(() => clampAllPanelsToViewport())
})

onBeforeUnmount(() => {
  if (pdfContainerRef) {
    pdfContainerRef.removeEventListener('scroll', onPdfScroll)
    pdfContainerRef = null
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (scrollRafId) {
    cancelAnimationFrame(scrollRafId)
  }
  window.removeEventListener('resize', clampAllPanelsToViewport)
})
</script>

<template>
  <!-- 拖动时显示的吸附提示 -->
  <div
    v-if="draggingPanelId && draggingPanelId !== TEXT_PANEL_ID && snapTargetRect && isNearSnapTarget"
    class="snap-hint fixed z-[998] pointer-events-none"
    :style="{
      left: snapTargetRect.left + 'px',
      top: snapTargetRect.top + 'px',
      width: snapTargetRect.width + 'px',
      height: snapTargetRect.height + 'px',
    }"
  >
    <div class="snap-hint-text">释放以吸附</div>
  </div>
  
  <!-- 渲染所有翻译面板 -->
  <template v-for="(panel, index) in visiblePanels" :key="panel.id">
    <div
      class="translation-panel popup-surface popup-surface--floating fixed overflow-hidden select-none"
      :class="{
        'is-snapped': panel.snapMode === 'paragraph',
        'is-dragging': draggingPanelId === panel.id,
        'is-text-panel': panel.isTextPanel
      }"
      :style="{
        left: panel.position.x + 'px',
        top: panel.position.y + 'px',
        width: panel.size.width + 'px',
        height: panel.size.height + 'px',
        zIndex: 1000 + index
      }"
      @mousedown="focusPanel(panel.id)"
      @wheel.capture="handlePanelWheel"
    >
      <!-- 头部 -->
      <div 
        class="panel-header popup-header cursor-move"
        @mousedown="startDrag($event, panel.id)"
      >
        <div class="flex items-center gap-1.5">
          <span class="popup-title">
            {{ panel.isTextPanel ? '划词翻译' : 'AI 译文' }}
          </span>
          <span v-if="panel.snapMode === 'paragraph'" class="popup-subtitle">已吸附</span>
        </div>
        <div class="flex items-center gap-0.5">
          <!-- 复制按钮 -->
          <button
            @click.stop="copyTranslation(panel)"
            class="popup-icon-btn"
            :title="copiedPanelId === panel.id ? '已复制' : '复制译文'"
            :disabled="panel.isLoading || !panel.translation"
          >
            <svg v-if="copiedPanelId === panel.id" class="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <svg v-else class="w-3 h-3 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke-width="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke-width="2" />
            </svg>
          </button>
          
          <!-- 字体大小控制 -->
          <button @click.stop="decreaseFontSize(panel.id)" class="popup-icon-btn" title="减小字体">
            <svg class="w-3 h-3 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
            </svg>
          </button>
          <button @click.stop="increaseFontSize(panel.id)" class="popup-icon-btn" title="增大字体">
            <svg class="w-3 h-3 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          
          <!-- 重新翻译 -->
          <button
            @click.stop="retranslate(panel)"
            class="popup-icon-btn"
            title="重新翻译"
            :disabled="panel.isLoading"
          >
            <svg class="w-3 h-3 text-gray-500 dark:text-gray-400" :class="{ 'animate-spin': panel.isLoading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          
          <!-- 关闭 -->
          <button
            @click.stop="closePanel(panel.id)"
            class="popup-icon-btn"
            title="关闭"
          >
            <svg class="w-3 h-3 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      
      <!-- 内容区域 -->
      <TranslationPanelItem
        v-if="!panel.isTextPanel"
        :panelId="panel.id"
        :paragraphId="panel.paragraphId"
        :translation="panel.translation"
        :isLoading="panel.isLoading"
        :fontSize="getFontSize(panel.id)"
      />
      <div v-else class="panel-content popup-body popup-scroll flex-1 overflow-y-auto cursor-auto select-text" @mousedown.stop>
        <div v-if="panel.isLoading" class="flex flex-col items-center justify-center py-6">
          <div class="popup-loading-spinner mb-2"></div>
          <span class="popup-text-muted">翻译中...</span>
        </div>

        <div
          v-else
          class="translation-text popup-text markdown-body prose prose-sm max-w-none"
          :data-panel-content="panel.id"
          :style="{ fontSize: getFontSize(panel.id) + 'px' }"
          v-html="renderMarkdown(panel.translation || '暂无翻译')"
        ></div>
      </div>
      
      <div class="resize-handle resize-w" @mousedown="startResize($event, panel.id, 'w')"></div>
      <div class="resize-handle resize-e" @mousedown="startResize($event, panel.id, 'e')"></div>
      <div class="resize-handle resize-s" @mousedown="startResize($event, panel.id, 's')"></div>
      <div class="resize-handle resize-sw" @mousedown="startResize($event, panel.id, 'sw')"></div>
      <div class="resize-handle resize-se" @mousedown="startResize($event, panel.id, 'se')"></div>
    </div>
  </template>
</template>

<style scoped>
.translation-panel {
  display: flex;
  flex-direction: column;
  transition: box-shadow var(--duration-normal) var(--ease-default),
              border-color var(--duration-normal) var(--ease-default);
}

.translation-panel.is-snapped {
  border: var(--border-width) solid var(--c-border-input);
}

.translation-panel.is-dragging {
  opacity: 0.9;
  cursor: grabbing;
}

/* header 统一紧凑样式（吸附前后保持一致） */
.translation-panel .panel-header {
  min-height: 24px;
  padding: 0 var(--popup-padding);
}

.resize-handle { position: absolute; background: transparent; }
.resize-w { left: 0; top: 36px; bottom: 6px; width: 4px; cursor: ew-resize; }
.resize-e { right: 0; top: 36px; bottom: 6px; width: 4px; cursor: ew-resize; }
.resize-s { bottom: 0; left: 6px; right: 6px; height: 4px; cursor: ns-resize; }
.resize-sw { left: 0; bottom: 0; width: 8px; height: 8px; cursor: nesw-resize; }
.resize-se { right: 0; bottom: 0; width: 8px; height: 8px; cursor: nwse-resize; }
.resize-handle:hover { background: rgba(120, 140, 160, 0.1); }

.snap-hint {
  border: var(--border-width-2) dashed var(--c-accent-light);
  border-radius: var(--radius-md);
  background: var(--c-accent-bg);
  transition: all var(--duration-fast) var(--ease-default);
  animation: snap-pulse 1s ease-in-out infinite;
}
@keyframes snap-pulse { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }

.snap-hint-text {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  padding: var(--space-1) var(--space-3);
  background: rgba(30, 58, 95, 0.92);
  color: var(--c-text-on-accent);
  font-size: var(--popup-muted-size); font-weight: var(--font-medium);
  border-radius: var(--radius-sm); white-space: nowrap;
  box-shadow: 0 2px 8px rgba(30, 58, 95, 0.35);
}

</style>

