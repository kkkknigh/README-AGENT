<script setup lang="ts">
/*
----------------------------------------------------------------------
                            PDF 查看器组件
----------------------------------------------------------------------
*/ 

// ------------------------- 导入依赖与类型 -------------------------
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue' 
import { useDebounceFn } from '@vueuse/core' 
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'

import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url'
import { usePdfStore } from '../../stores/pdf'
import { useTranslationStore } from '../../stores/translation'
import type { Highlight } from '../../types'
import { pdfApi } from '../../api'
import { clamp } from '@vueuse/core'

// 导入拆分出的模块
import type { PageRef, PageSize } from '../../types/pdf'
import {
  getPageSize,
  getScaledPageSize,
  getPageTop,
  getPageAtY,
  findPageElement,
  getHighlightColor,
  getBoundingBoxStyle,
  getParagraphMarkerStyle,
  CLICK_TIME_THRESHOLD,
  DRAG_DISTANCE_THRESHOLD
} from '../../utils/PdfHelper'
import { applyInterimScaleToPage, getParagraphByCoords } from '../../utils/PdfRender'
import { useZoomAnchor } from '../../composables/useZoomAnchor'
import { usePageRender } from '../../composables/usePageRender'
import { usePdfSelection } from '../../composables/usePdfSelection'
import { useNotesLookup } from '../../composables/useNotesLookup'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'

import TextSelectionTooltip from './TextSelectionTooltip.vue' 
import TranslationPanel from './TranslationPanel.vue' 
import PageTranslationSidebar from './PageTranslationSidebar.vue'
import NotePreviewCard from './NotePreviewCard.vue'
import InternalLinkPopup from './InternalLinkPopup.vue' 
import { useHighlightsQuery } from '../../composables/queries/useHighlightQueries'
import { useDocumentsQuery } from '../../composables/queries/useLibraryQueries'
import { trackEvent, flushEvents } from '../../utils/tracking'

GlobalWorkerOptions.workerSrc = pdfWorker

// ------------------------- 初始化 store 实例 -------------------------
const pdfStore = usePdfStore() 
const translationStore = useTranslationStore()

// ------------------------- 初始化 PDF 状态与引用 -------------------------
const containerRef = ref<HTMLElement | null>(null) 
const pdfDoc = shallowRef<PDFDocumentProxy | null>(null) 

// ------------------------- Vue Query -------------------------
const { data: documents } = useDocumentsQuery()
const { data: highlights } = useHighlightsQuery(computed(() => pdfStore.activeReaderId))

const currentDocument = computed(() => {
  if (!documents.value || !pdfStore.activeReaderId) return null
  return documents.value.find(d => d.id === pdfStore.activeReaderId) || null
})

// ------------------------- 按页缓存数据（性能优化） -------------------------
// 将 highlights、paragraphs、layoutOverlays 按页分组缓存，避免模板中重复计算
import type { PdfParagraph } from '../../types'

const highlightsByPage = computed(() => {
  const map = new Map<number, Highlight[]>()
  if (!highlights.value) return map
  for (const hl of highlights.value) {
    const list = map.get(hl.page) || []
    list.push(hl)
    map.set(hl.page, list)
  }
  return map
})

const paragraphsByPage = computed(() => {
  const map = new Map<number, PdfParagraph[]>()
  for (const p of pdfStore.paragraphs) {
    const list = map.get(p.page) || []
    list.push(p)
    map.set(p.page, list)
  }
  return map
})

type LayoutOverlay = {
  id: string
  page: number
  kind: 'image' | 'table' | 'formula'
  bboxNorm: { left: number; top: number; width: number; height: number }
}

const layoutOverlaysByPage = computed(() => {
  const map = new Map<number, LayoutOverlay[]>()
  for (const overlay of pdfStore.layoutOverlays as LayoutOverlay[]) {
    const list = map.get(overlay.page) || []
    list.push(overlay)
    map.set(overlay.page, list)
  }
  return map
})

const pageNumbers = ref<number[]>([]) 
const pageRefs = new Map<number, PageRef>() 
const renderTasks = new Map<number, RenderTask>() 
const pagesNeedingRefresh = new Set<number>()
const lastRenderedScale = new Map<number, number>() 

const pageSizesConstant = ref<PageSize | null>(null)
const pageSizesArray = ref<PageSize[] | null>(null)
const pageHeightAccumulator = ref<number[]>([])

const renderedPages = shallowRef<Set<number>>(new Set())
const isZooming = ref(false)
const isPointerOverPdf = ref(false)

const showTooltip = ref(false)
const tooltipPosition = ref({ x: 0, y: 0 })

const highlightsAtCurrentPoint = ref<Highlight[]>([])
const currentHighlightIndex = ref(0)
const hoveredOverlayId = ref<string | null>(null)

type OverlayKind = 'image' | 'table' | 'formula'
type OverlayRef = {
  id: string
  page: number
  kind: OverlayKind
  bboxNorm: { left: number; top: number; width: number; height: number }
}
type OverlayChatMessage = { role: 'user' | 'assistant'; content: string }
const activeOverlayChat = ref<{
  overlay: OverlayRef
  imageDataUrl: string
  uploadImageDataUrl: string
  messages: OverlayChatMessage[]
  draft: string
  loading: boolean
  error: string
} | null>(null)

const mouseDownInfo = ref<{ x: number; y: number; time: number } | null>(null)
const linksDisabled = ref(false)

const preloadProgress = ref(0)
const isPreloading = ref(false)
let preloadAbortController: AbortController | null = null
let pageSizeScanVersion = 0

let resizeObserver: ResizeObserver | null = null
let resizeTimeout: ReturnType<typeof setTimeout> | null = null
const isResizing = ref(false)



// Zoom 节流相关
let zoomRafId: number | null = null
let pendingZoomDelta = 0
let lastZoomEvent: WheelEvent | null = null
let restoreAnchorSeq = 0

// ------------------------- 初始化 composables -------------------------
const scaleRef = computed(() => pdfStore.scale)
const readerPopupScale = computed(() => clamp(pdfStore.scale || 1, 0.85, 1.35))
const readerPopupStyleVars = computed(() => {
  const scale = readerPopupScale.value
  const text = Math.max(10, Math.round(10 * scale))
  const muted = Math.max(9, Math.round(9 * scale))
  const title = Math.max(10, Math.round(10 * scale))
  const subtitle = Math.max(9, Math.round(9 * scale))
  const label = muted
  const badge = Math.max(9, Math.round(9 * scale))
  const button = Math.max(9, Math.round(9 * scale))
  const headerHeight = Math.round(36 * scale)
  const radius = Math.round(8 * scale)
  const padding = Math.round(12 * scale)
  const gap = Math.max(6, Math.round(8 * scale))
  const iconBtn = Math.round(22 * scale)
  const spinner = Math.round(20 * scale)
  return {
    '--reader-popup-scale': `${scale}`,
    '--reader-popup-text-size': `${text}px`,
    '--reader-popup-muted-size': `${muted}px`,
    '--reader-popup-title-size': `${title}px`,
    '--reader-popup-subtitle-size': `${subtitle}px`,
    '--reader-popup-label-size': `${label}px`,
    '--reader-popup-badge-size': `${badge}px`,
    '--reader-popup-button-size': `${button}px`,
    '--reader-popup-header-height': `${headerHeight}px`,
    '--reader-popup-radius': `${radius}px`,
    '--reader-popup-padding': `${padding}px`,
    '--reader-popup-gap': `${gap}px`,
    '--reader-popup-icon-btn-size': `${iconBtn}px`,
    '--reader-popup-spinner-size': `${spinner}px`,
    '--reader-popup-input-padding-y': `${Math.max(6, Math.round(8 * scale))}px`,
    '--reader-popup-input-padding-x': `${Math.max(8, Math.round(10 * scale))}px`,
    '--reader-popup-badge-padding-y': `${Math.max(4, Math.round(5 * scale))}px`,
    '--reader-popup-badge-padding-x': `${Math.max(6, Math.round(8 * scale))}px`,
    '--reader-popup-line-height': scale < 1 ? '1.45' : '1.5',
  }
})

// ------------------------- 事件监听与响应式处理 -------------------------
const {
  pendingAnchor,
  captureCenterAnchor,
  restoreAnchor,
  setPendingAnchor,
  clearPendingAnchor
} = useZoomAnchor(
  containerRef,
  pageNumbers,
  pageRefs,
  pageSizesConstant,
  pageSizesArray,
  pageHeightAccumulator,
  scaleRef
)

const {
  updateVisiblePages,
  renderPage,
  scrollToPage,
  shouldRenderPageContent,
  setCurrentPageForRender,
  clearVisitedPages
} = usePageRender(
  containerRef,
  pdfDoc,
  pageNumbers,
  pageRefs,
  renderTasks,
  renderedPages,
  pagesNeedingRefresh,
  lastRenderedScale,
  pageSizesConstant,
  pageSizesArray,
  pageHeightAccumulator,
  scaleRef,
  isZooming
)

const {
  handleTextSelection,
} = usePdfSelection({
  onTextSelected: (text, position, page, rects) => {
    pdfStore.setSelectedText(text, position)
    pdfStore.setSelectionInfo({ page, rects })
    tooltipPosition.value = position
    showTooltip.value = true

    // 埋点：text_selected
    trackEvent('text_selected', {
      selected_text_length: text.length,
      page_number: page,
      paper_id: pdfStore.activeReaderId,
      page_name: 'reader_page',
      module_name: 'pdf_reader',
    })
  },
  onHighlightSelected: (highlight, position) => {
    pdfStore.selectHighlight(highlight as any, position)
  },
  onClickOutside: handleClickOutside,
  getHighlightsAtPoint: pdfStore.getHighlightsAtPoint.bind(pdfStore),
  highlights: () => highlights.value || []
})

const {
  handleCtrlClick
} = useNotesLookup({
  pdfId: computed(() => currentDocument.value?.id || null),
  onNoteFound: (note, position) => {
    pdfStore.closeNotePreviewCard()
    pdfStore.openNotePreviewCard(
      { id: note.id, title: note.title, content: note.content },
      position
    )
  }
})

const { renderMarkdown } = useMarkdownRenderer()

// ------------------------- 事件监听与响应式处理 -------------------------
const settleZooming = useDebounceFn(() => {
  isZooming.value = false
  updateVisiblePages()
  startBackgroundPreload()
}, 300)

// ------------------------- 辅助函数 -------------------------
function isPageRendered(pageNumber: number): boolean {
  if (!renderedPages.value.has(pageNumber)) return false

  const refs = pageRefs.get(pageNumber)
  if (!refs) return false

  const liveCanvas = refs.container.querySelector('canvas')
  if (!(liveCanvas instanceof HTMLCanvasElement)) return false

  return liveCanvas.dataset.rendered === '1'
}

function getLayoutOverlayStyle(overlay: { bboxNorm: { left: number; top: number; width: number; height: number } }) {
  return {
    left: `${overlay.bboxNorm.left * 100}%`,
    top: `${overlay.bboxNorm.top * 100}%`,
    width: `${overlay.bboxNorm.width * 100}%`,
    height: `${overlay.bboxNorm.height * 100}%`,
  }
}

function getLayoutOverlayClass(kind: string) {
  if (kind === 'table') return 'layout-overlay-table'
  if (kind === 'formula') return 'layout-overlay-formula'
  return 'layout-overlay-image'
}


function isOverlayHovered(overlayId: string) {
  return hoveredOverlayId.value === overlayId
}

function setHoveredOverlay(overlayId: string | null) {
  hoveredOverlayId.value = overlayId
}

function isOverlayChatOpen(overlayId: string) {
  return activeOverlayChat.value?.overlay.id === overlayId
}

function closeOverlayChat() {
  activeOverlayChat.value = null
}

function getParagraphTranslationText(paragraph: { id: string; translation?: string }) {
  const cached = translationStore.translatedParagraphsCache.get(paragraph.id)
  if (typeof cached === 'string' && cached.trim()) return cached

  return paragraph.translation || ''
}

function isTranslatableParagraph(paragraph: PdfParagraph) {
  return typeof paragraph.content === 'string' && paragraph.content.trim().length > 0
}

function hasFrontendCachedTranslation(paragraph: PdfParagraph) {
  return getParagraphTranslationText(paragraph).trim().length > 0
}

function isPageFullyCachedByFrontend(page: number) {
  const pageParagraphs = (paragraphsByPage.value.get(page) || []).filter(isTranslatableParagraph)
  if (!pageParagraphs.length) return false
  return pageParagraphs.every((paragraph) => hasFrontendCachedTranslation(paragraph))
}

function getPageTranslationSidebarParagraphs(page: number) {
  return (paragraphsByPage.value.get(page) || []).map((paragraph) => ({
    id: paragraph.id,
    content: paragraph.content,
    translation: getParagraphTranslationText(paragraph),
  }))
}

function getPageTranslationSidebarWidth(page: number) {
  const pageSize = getScaledPageSize(page, pdfStore.scale, pageSizesConstant.value, pageSizesArray.value)
  return Math.round(pageSize.width / 2)
}

function getPageRowStyle(page: number) {
  const pageSize = getScaledPageSize(page, pdfStore.scale, pageSizesConstant.value, pageSizesArray.value)
  const sidebarWidth = pdfStore.showFullTranslationSidebar ? getPageTranslationSidebarWidth(page) : 0
  return {
    height: `${pageSize.height}px`,
    width: `${pageSize.width + (pdfStore.showFullTranslationSidebar ? sidebarWidth + 16 : 0)}px`,
  }
}

function getOverlayChatPanelClass(overlay: { bboxNorm: { left: number; top: number; width: number; height: number } }) {
  return {
    'open-up': overlay.bboxNorm.top + overlay.bboxNorm.height > 0.62,
    'open-left': overlay.bboxNorm.left + overlay.bboxNorm.width > 0.72,
  }
}

function getOverlayChatPanelStyle(page: number) {
  const pageSize = getScaledPageSize(page, pdfStore.scale, pageSizesConstant.value, pageSizesArray.value)
  const panelWidth = Math.round(pageSize.width * 0.42)
  const panelHeight = Math.round(pageSize.height * 0.42)
  const scaleFactor = Math.min(1.35, Math.max(0.68, pageSize.width / 612))
  const radius = Math.max(8, Math.round(10 * scaleFactor))
  const panelPadding = Math.max(8, Math.round(10 * scaleFactor))
  const gap = Math.max(6, Math.round(8 * scaleFactor))
  const imageMaxHeight = Math.round(panelHeight * 0.28)
  return {
    width: `${panelWidth}px`,
    minWidth: `${panelWidth}px`,
    maxWidth: `${panelWidth}px`,
    height: `${panelHeight}px`,
    maxHeight: `${panelHeight}px`,
    '--overlay-chat-padding': `${panelPadding}px`,
    '--overlay-chat-radius': `${radius}px`,
    '--overlay-chat-gap': `${gap}px`,
    '--overlay-chat-image-max-height': `${imageMaxHeight}px`,
    '--overlay-chat-button-padding-y': `${Math.max(6, Math.round(8 * scaleFactor))}px`,
    '--overlay-chat-button-padding-x': `${Math.max(10, Math.round(12 * scaleFactor))}px`,
  }
}

async function cropOverlayToBlob(overlay: {
  id: string
  page: number
  bboxNorm: { left: number; top: number; width: number; height: number }
}) {
  const refs = pageRefs.get(overlay.page)
  if (!refs?.canvas) {
    return null
  }

  const canvas = refs.canvas
  const left = clamp(overlay.bboxNorm.left, 0, 1)
  const top = clamp(overlay.bboxNorm.top, 0, 1)
  const right = clamp(left + overlay.bboxNorm.width, 0, 1)
  const bottom = clamp(top + overlay.bboxNorm.height, 0, 1)

  const sx = Math.floor(left * canvas.width)
  const sy = Math.floor(top * canvas.height)
  const sw = Math.max(1, Math.ceil((right - left) * canvas.width))
  const sh = Math.max(1, Math.ceil((bottom - top) * canvas.height))

  const croppedCanvas = document.createElement('canvas')
  croppedCanvas.width = sw
  croppedCanvas.height = sh

  const ctx = croppedCanvas.getContext('2d')
  if (!ctx) {
    return null
  }

  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)

  return new Promise<Blob | null>((resolve) => {
    croppedCanvas.toBlob((result) => resolve(result), 'image/png')
  })
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

async function requestOverlayExplanation(overlay: {
  id: string
  page: number
  kind: string
  bboxNorm: { left: number; top: number; width: number; height: number }
}) {
  const pdfId = currentDocument.value?.id || pdfStore.activeReaderId || null
  if (!pdfId) return

  const kind: OverlayKind = overlay.kind === 'table' || overlay.kind === 'formula' ? overlay.kind : 'image'

  // 前端裁剪 canvas 生成缩略图（用于显示）
  const blob = await cropOverlayToBlob(overlay)
  const imageDataUrl = blob ? URL.createObjectURL(blob) : ''
  const uploadImageDataUrl = blob ? await blobToDataUrl(blob) : ''

  activeOverlayChat.value = {
    overlay: {
      id: overlay.id,
      page: overlay.page,
      kind,
      bboxNorm: overlay.bboxNorm,
    },
    imageDataUrl,  // 前端自己生成的缩略图
    uploadImageDataUrl,
    messages: [],
    draft: '',
    loading: true,
    error: '',
  }

  try {
    // 只传 overlayId，后端自己从数据库获取数据
    const result = await pdfApi.explainOverlay(pdfId, {
      overlayId: overlay.id,
      page: overlay.page,
      kind,
      bboxNorm: overlay.bboxNorm,  // 可选，仅用于 fallback
      imageDataUrl: uploadImageDataUrl,
    })

    if (!activeOverlayChat.value || activeOverlayChat.value.overlay.id !== overlay.id) return
    activeOverlayChat.value.messages = [{ role: 'assistant', content: result.analysis || 'No explanation returned.' }]
  } catch (error) {
    console.error('Failed to explain overlay:', error)
    if (activeOverlayChat.value && activeOverlayChat.value.overlay.id === overlay.id) {
      activeOverlayChat.value.error = 'Overlay explanation failed. Please try again.'
    }
  } finally {
    if (activeOverlayChat.value && activeOverlayChat.value.overlay.id === overlay.id) {
      activeOverlayChat.value.loading = false
    }
  }
}

async function sendOverlayChatMessage() {
  const panel = activeOverlayChat.value
  const pdfId = currentDocument.value?.id || pdfStore.activeReaderId || null
  if (!panel || !pdfId || panel.loading) return

  const text = panel.draft.trim()
  if (!text) return

  const overlayId = panel.overlay.id
  const history = panel.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
  panel.messages = [...panel.messages, { role: 'user', content: text }]
  panel.draft = ''
  panel.error = ''
  panel.loading = true

  try {
    const result = await pdfApi.chatOverlay(pdfId, {
      overlayId: panel.overlay.id,
      page: panel.overlay.page,
      kind: panel.overlay.kind,
      bboxNorm: panel.overlay.bboxNorm,
      message: text,
      history,
      imageDataUrl: panel.uploadImageDataUrl,
    })

    if (!activeOverlayChat.value || activeOverlayChat.value.overlay.id !== overlayId) return
    if (!activeOverlayChat.value.imageDataUrl && result.imageDataUrl) {
      activeOverlayChat.value.imageDataUrl = result.imageDataUrl
    }
    activeOverlayChat.value.messages = [
      ...activeOverlayChat.value.messages,
      { role: 'assistant', content: result.answer || 'No explanation returned.' },
    ]
  } catch (error) {
    console.error('Failed to chat with overlay:', error)
    if (activeOverlayChat.value && activeOverlayChat.value.overlay.id === overlayId) {
      activeOverlayChat.value.error = 'Overlay follow-up failed. Please try again.'
    }
  } finally {
    if (activeOverlayChat.value && activeOverlayChat.value.overlay.id === overlayId) {
      activeOverlayChat.value.loading = false
    }
  }
}

async function copyOverlayImage(overlay: {
  id: string
  page: number
  kind?: string
  bboxNorm: { left: number; top: number; width: number; height: number }
}) {
  // 如果是公式，复制 LaTeX 文本
  if (overlay.kind === 'formula') {
    const pdfId = currentDocument.value?.id || pdfStore.activeReaderId || null
    if (!pdfId) return

    try {
      const index = parseInt(overlay.id.split('-').pop() || '0')
      const result = await pdfApi.getFormulaLatex(pdfId, overlay.page, index)

      if (result.latex) {
        await navigator.clipboard.writeText(result.latex)
        return
      }
    } catch (error) {
      console.warn('[Copy] Failed to get LaTeX, fallback to image:', error)
    }
  }

  // 图片/表格 或 公式 fallback：裁剪 canvas
  const blob = await cropOverlayToBlob(overlay)

  if (!blob) return

  try {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return
    }
  } catch (error) {
    console.warn('Clipboard write failed, fallback to download:', error)
  }

  const fallbackUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = fallbackUrl
  a.download = `${overlay.id}.png`
  a.click()
  URL.revokeObjectURL(fallbackUrl)
}

// ------------------------- 引用处理与资源管理 -------------------------
function handlePageContainerRef(
  pageNumber: number,
  el: Element | { $el: Element } | null
) {
  const htmlEl = el instanceof HTMLElement ? el : null
  setPageRef(pageNumber, htmlEl)
}

function setPageRef(pageNumber: number, el: HTMLElement | null) {
  if (!el) {
    pageRefs.delete(pageNumber)
    return
  }

  const canvas = el.querySelector('canvas')
  const textLayer = el.querySelector('.textLayer')
  const linkLayer = el.querySelector('.linkLayer')
  const highlightLayer = el.querySelector('.highlightLayer')

  if (
    canvas instanceof HTMLCanvasElement &&
    textLayer instanceof HTMLDivElement &&
    linkLayer instanceof HTMLDivElement &&
    highlightLayer instanceof HTMLDivElement
  ) {
    pageRefs.set(pageNumber, {
      container: el,
      canvas,
      textLayer,
      linkLayer,
      highlightLayer
    })
  } else {
    // 对于空白页面，使用脱离 DOM 的占位 canvas，保证缩放链路不会访问空引用。
    const placeholderCanvas = document.createElement('canvas')
    pageRefs.set(pageNumber, {
      container: el,
      canvas: placeholderCanvas,
      textLayer: textLayer as HTMLDivElement,
      linkLayer: linkLayer as HTMLDivElement,
      highlightLayer: highlightLayer as HTMLDivElement
    })
  }
}

// ------------------------- 渲染核心与监听调度 -------------------------
const handleScroll = useDebounceFn(() => {
  if (!containerRef.value) return

  updateVisiblePages()

  const scrollTop = containerRef.value.scrollTop
  const p = getPageAtY(
    scrollTop,
    pageNumbers.value.length,
    pdfStore.scale,
    pageSizesConstant.value,
    pageSizesArray.value,
    pageHeightAccumulator.value
  )

  let nearestPage = p
  const minDistance = Math.abs(getPageTop(p, pdfStore.scale, pageSizesConstant.value, pageSizesArray.value, pageHeightAccumulator.value) - scrollTop)

  if (p < pdfStore.totalPages) {
    const nextP = p + 1
    const distNext = Math.abs(getPageTop(nextP, pdfStore.scale, pageSizesConstant.value, pageSizesArray.value, pageHeightAccumulator.value) - scrollTop)
    if (distNext < minDistance) {
      nearestPage = nextP
    }
  }

  // 仅更新页码显示，不触发滚动对齐
  if (nearestPage !== pdfStore.currentPage && nearestPage <= pdfStore.totalPages) {
    lastUserTriggeredPage = nearestPage
    pdfStore.goToPage(nearestPage)
  }
  
  // 更新渲染范围中心页面（用于虚拟滚动计算）
  setCurrentPageForRender(nearestPage)
}, 50)

// ------------------------- PDF 文档加载与预加载策略 -------------------------
async function loadPdf(url: string) {
  cleanup()
  clearVisitedPages() // 清除已访问页面记录
  pdfStore.isLoading = true
  const currentSizeScanVersion = ++pageSizeScanVersion

  const loadingTask = getDocument({
    url,
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
    cMapPacked: true
  })

  try {
    const pdf = await loadingTask.promise
    pdfDoc.value = pdf
    pageNumbers.value = Array.from({ length: pdf.numPages }, (_, index) => index + 1)

    await preloadPageSizes(pdf, currentSizeScanVersion)
    pdfStore.setTotalPages(pdf.numPages)
    pdfStore.isLoading = false

    await nextTick()
    updateVisiblePages()
    void finalizePageSizes(pdf, currentSizeScanVersion)
    setTimeout(() => startBackgroundPreload(), 500)
  } catch (err) {
    console.error('Failed to load PDF:', err)
    pdfStore.isLoading = false
  }
}

function applyPageSizes(constant: PageSize | null, array: PageSize[] | null, accumulator: number[]) {
  pageSizesConstant.value = constant
  pageSizesArray.value = array
  pageHeightAccumulator.value = accumulator

  // 同步到 store 以备其它组件使用
  pdfStore.setPageSizes(pageSizesConstant.value, pageSizesArray.value)
}

async function preloadPageSizes(pdf: PDFDocumentProxy, sizeScanVersion: number) {
  const firstPage = await pdf.getPage(1)
  if (sizeScanVersion !== pageSizeScanVersion) return

  const viewport = firstPage.getViewport({ scale: 1 })
  applyPageSizes(
    { width: viewport.width, height: viewport.height },
    null,
    []
  )
}

async function finalizePageSizes(pdf: PDFDocumentProxy, sizeScanVersion: number) {
  const tempSizes: PageSize[] = []
  const tempAccumulator: number[] = [0]
  let currentAccHeight = 0
  let allSameSize = true
  let firstSize: PageSize | null = null

  for (let i = 1; i <= pdf.numPages; i++) {
    if (sizeScanVersion !== pageSizeScanVersion) return

    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const size: PageSize = { width: viewport.width, height: viewport.height }

    if (i === 1) {
      firstSize = size
    } else if (firstSize) {
      if (Math.abs(size.width - firstSize.width) > 1 || Math.abs(size.height - firstSize.height) > 1) {
        allSameSize = false
      }
    }

    tempSizes.push(size)
    currentAccHeight += size.height
    if (i < pdf.numPages) {
      tempAccumulator.push(currentAccHeight)
    }

    if (i % 8 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  if (sizeScanVersion !== pageSizeScanVersion) return

  if (allSameSize && firstSize) {
    applyPageSizes(firstSize, null, [])
  } else {
    applyPageSizes(null, tempSizes, tempAccumulator)
  }

  await nextTick()
  updateVisiblePages()
}

async function startBackgroundPreload() {
  const pdf = pdfDoc.value
  if (!pdf) return

  if (preloadAbortController) {
    preloadAbortController.abort()
  }
  preloadAbortController = new AbortController()
  const signal = preloadAbortController.signal

  isPreloading.value = true
  preloadProgress.value = 0

  const totalPages = pdf.numPages
  let loadedCount = 0

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    if (signal.aborted) break

    // 仅预加载当前虚拟渲染窗口内页面，避免远端页面被提前标记为 rendered。
    if (!shouldRenderPageContent.value(pageNumber)) {
      loadedCount++
      preloadProgress.value = Math.round((loadedCount / totalPages) * 100)
      continue
    }

    if (renderedPages.value.has(pageNumber)) {
      loadedCount++
      preloadProgress.value = Math.round((loadedCount / totalPages) * 100)
      continue
    }

    const refs = pageRefs.get(pageNumber)
    if (refs && !renderTasks.has(pageNumber)) {
      await new Promise<void>((resolve) => {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(() => {
            if (signal.aborted) {
              resolve()
              return
            }
            void renderPage(pageNumber).finally(resolve)
          }, { timeout: 100 })
        } else {
          setTimeout(() => {
            if (signal.aborted) {
              resolve()
              return
            }
            void renderPage(pageNumber).finally(resolve)
          }, 10)
        }
      })
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    loadedCount++
    preloadProgress.value = Math.round((loadedCount / totalPages) * 100)
  }

  isPreloading.value = false
  preloadProgress.value = 100
}

function cleanup() {
  pageSizeScanVersion += 1

  if (preloadAbortController) {
    preloadAbortController.abort()
    preloadAbortController = null
  }
  isPreloading.value = false
  preloadProgress.value = 0

  renderTasks.forEach((task) => task.cancel())
  renderTasks.clear()
  
  // 释放 Blob URL 的逻辑已经整合到 pdfStore

  pageRefs.clear()
  pageNumbers.value = []
  pageSizesConstant.value = null
  pageSizesArray.value = null
  pageHeightAccumulator.value = []
  renderedPages.value = new Set()
  pagesNeedingRefresh.clear()
  lastRenderedScale.clear()
  isZooming.value = false
  pdfDoc.value = null

  if (zoomRafId) {
    cancelAnimationFrame(zoomRafId)
    zoomRafId = null
  }
  pendingZoomDelta = 0
  lastZoomEvent = null
}

// ------------------------- 交互处理 -------------------------
function applyInterimScale() {
  pageRefs.forEach((refs, pageNumber) => {
    const size = getPageSize(pageNumber, pageSizesConstant.value, pageSizesArray.value)
    if (!size) return

    applyInterimScaleToPage(
      refs,
      pageNumber,
      pdfStore.scale,
      lastRenderedScale.get(pageNumber),
      size
    )
  })
}

function handleMouseEnterContainer() {
  isPointerOverPdf.value = true
}

function handleMouseLeaveContainer() {
  isPointerOverPdf.value = false
  linksDisabled.value = false
}

function applyZoomFromWheel(event: Pick<WheelEvent, 'deltaY' | 'clientX' | 'clientY'>) {
  const container = containerRef.value
  if (!container) return

  pendingZoomDelta += event.deltaY
  lastZoomEvent = event as WheelEvent

  if (zoomRafId) return

  zoomRafId = requestAnimationFrame(() => {
    zoomRafId = null

    // 始终使用鼠标位置作为锚点，实现"以鼠标为中心缩放"的效果
    // 无论是否横向溢出，都基于鼠标位置计算锚点
    if (lastZoomEvent) {
      setPendingAnchor(captureCenterAnchor({ x: lastZoomEvent.clientX, y: lastZoomEvent.clientY }))
    } else {
      setPendingAnchor(captureCenterAnchor())
    }

    const step = clamp(Math.abs(pendingZoomDelta) / 50, 0.05, 0.25)
    const nextScale = pendingZoomDelta < 0 ? pdfStore.scale + step : pdfStore.scale - step
    pdfStore.setScale(nextScale)

    pendingZoomDelta = 0
    lastZoomEvent = null
  })
}

function handleWheel(event: WheelEvent) {
  // 检查鼠标是否在 PDF 区域或全文翻译区域
  const target = event.target as HTMLElement
  const isOverTranslationSidebar = target.closest('.page-translation-sidebar') !== null
  
  if (!isPointerOverPdf.value && !isOverTranslationSidebar) return

  const container = containerRef.value
  if (!container) return

  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    event.stopPropagation()
    applyZoomFromWheel(event)
    return
  }

  const deltaX = event.deltaX
  if (Math.abs(deltaX) > Math.abs(event.deltaY) * 0.5) {
    const scrollLeft = container.scrollLeft
    const maxScrollLeft = container.scrollWidth - container.clientWidth
    const canScrollRight = scrollLeft < maxScrollLeft - 1
    const canScrollLeft = scrollLeft > 1

    if ((deltaX > 0 && canScrollRight) || (deltaX < 0 && canScrollLeft)) {
      container.scrollLeft = Math.round(container.scrollLeft + deltaX)
      event.preventDefault()
    }
  }
}

function handleExternalZoomWheel(event: Event) {
  const customEvent = event as CustomEvent<{ deltaY: number; clientX: number; clientY: number }>
  if (!customEvent.detail) return
  applyZoomFromWheel(customEvent.detail)
}

function handleMouseMove(event: MouseEvent) {
  const down = mouseDownInfo.value
  if (!down || linksDisabled.value) return

  const elapsed = Date.now() - down.time
  const dx = event.clientX - down.x
  const dy = event.clientY - down.y
  const dist = Math.hypot(dx, dy)

  if (elapsed >= CLICK_TIME_THRESHOLD || dist >= DRAG_DISTANCE_THRESHOLD) {
    linksDisabled.value = true
  }
}

function handleMouseDown(event: MouseEvent) {
  mouseDownInfo.value = { x: event.clientX, y: event.clientY, time: Date.now() }
  linksDisabled.value = false
}

function handleMouseUp(event: MouseEvent) {
  const downInfo = mouseDownInfo.value
  mouseDownInfo.value = null

  const isDrag = !!downInfo && (
    (Date.now() - downInfo.time >= CLICK_TIME_THRESHOLD) ||
    (Math.hypot(event.clientX - downInfo.x, event.clientY - downInfo.y) >= DRAG_DISTANCE_THRESHOLD)
  )

  if (isDrag) {
    // 获取当前鼠标位置所在的页码
    const pageEl = findPageElement(event.target as Node)
    const pageNumber = pageEl ? Number(pageEl.dataset.page) : undefined
    handleTextSelection(event, pageNumber)
    linksDisabled.value = true // 让 selection 正常工作
    return
  }

  const target = event.target as HTMLElement
  if (target.tagName === 'A' || target.closest('a') || target.classList.contains('internal-link') || target.closest('.internal-link')) {
    linksDisabled.value = false
    return
  }

  if (event.ctrlKey || event.metaKey) {
    pdfStore.closeNotePreviewCard()
    handleCtrlClick(event)
    // Ctrl+Click 选中单词后，触发浮动工具栏
    const pageEl = findPageElement(event.target as Node)
    const pageNumber = pageEl ? Number(pageEl.dataset.page) : undefined
    handleTextSelection(event, pageNumber)
    linksDisabled.value = false
    return
  }

  handleClick(event)
  linksDisabled.value = false
}

function handleClick(event: MouseEvent) {
  const pageEl = findPageElement(event.target as Node)
  if (!pageEl || !pageEl.dataset.page) {
    handleClickOutside(true)
    return
  }

  const pageNumber = Number(pageEl.dataset.page)
  const textLayer = pageEl.querySelector('.textLayer') as HTMLDivElement | null
  if (!textLayer) return

  const layerRect = textLayer.getBoundingClientRect()
  if (!layerRect.width || !layerRect.height) return

  const normalizedX = (event.clientX - layerRect.left) / layerRect.width
  const normalizedY = (event.clientY - layerRect.top) / layerRect.height

  const highlightsAtPoint = pdfStore.getHighlightsAtPoint(highlights.value || [], pageNumber, normalizedX, normalizedY)

  if (highlightsAtPoint.length === 0) {
    handleClickOutside(true)
    return
  }

  const isSamePoint = highlightsAtCurrentPoint.value.length > 0 &&
    highlightsAtCurrentPoint.value.some(h => highlightsAtPoint.some(hp => hp.id === h.id))

  if (isSamePoint && highlightsAtPoint.length > 1) {
    currentHighlightIndex.value = (currentHighlightIndex.value + 1) % highlightsAtPoint.length
  } else {
    highlightsAtCurrentPoint.value = highlightsAtPoint
    currentHighlightIndex.value = 0
  }

  const selectedHighlight = highlightsAtPoint[currentHighlightIndex.value]
  if (!selectedHighlight) return

  const firstRect = selectedHighlight.rects[0]
  if (!firstRect) return

  const tooltipX = layerRect.left + (firstRect.left + firstRect.width / 2) * layerRect.width
  const tooltipY = layerRect.top + firstRect.top * layerRect.height - 10

  pdfStore.selectHighlight(selectedHighlight, { x: tooltipX, y: tooltipY })
  tooltipPosition.value = { x: tooltipX, y: tooltipY }
  showTooltip.value = true

  window.getSelection()?.removeAllRanges()
}

function handleClickOutside(forceClose: boolean = false) {
  const selection = window.getSelection()
  if (!forceClose && selection && selection.toString().trim()) return

  selection?.removeAllRanges()
  showTooltip.value = false
  pdfStore.clearSelection()
  pdfStore.clearHighlightSelection()
  pdfStore.closeNotePreviewCard()
  highlightsAtCurrentPoint.value = []
  currentHighlightIndex.value = 0
}

function closeTooltip() {
  showTooltip.value = false
  pdfStore.clearSelection()
  pdfStore.clearHighlightSelection()
  highlightsAtCurrentPoint.value = []
  currentHighlightIndex.value = 0
}

function handleParagraphMarkerClick(event: MouseEvent, paragraphId: string, originalText: string) {
  event.stopPropagation()
  event.preventDefault()

  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const panelX = rect.right + 10
  const panelY = rect.top
  const panelWidth = 320
  const finalX = (panelX + panelWidth > window.innerWidth) ? (rect.left - panelWidth - 10) : panelX

  translationStore.openTranslationPanel(paragraphId, { x: Math.max(0, finalX), y: Math.max(0, panelY) }, originalText)
}

function handlePageTranslateClick(page: number) {
  const status = pdfStore.pageTranslationStatus[page]
  if (!status || status === 'idle' || status === 'failed') {
    trackEvent('paragraph_translate_clicked', {
      page_number: page,
      paper_id: pdfStore.activeReaderId,
      page_name: 'reader_page',
      module_name: 'pdf_reader',
    })
  }
  pdfStore.startPagePreTranslation(page)
}

// ------------------------- Watch 鐩戝惉 -------------------------
watch(
  () => pdfStore.currentPdfUrl,
  (url, oldUrl) => {
    showTooltip.value = false
    highlightsAtCurrentPoint.value = []
    currentHighlightIndex.value = 0

    // immediate 首次触发时 oldUrl 为 undefined，不需要关闭面板
    if (oldUrl) {
      pdfStore.showFullTranslationSidebar = false
    }

    if (url) {
      loadPdf(url)
    } else {
      cleanup()
    }
  },
  { immediate: true }
)

watch(
  () => pdfStore.scale,
  () => {
    if (!pendingAnchor.value) {
      setPendingAnchor(captureCenterAnchor())
    }

    isZooming.value = true

    if (preloadAbortController) {
      preloadAbortController.abort()
      preloadAbortController = null
    }

    renderTasks.forEach(task => task.cancel())
    renderTasks.clear()
    pagesNeedingRefresh.clear()
    pageRefs.forEach((_, pageNumber) => pagesNeedingRefresh.add(pageNumber))
    preloadProgress.value = 0

    applyInterimScale()

    nextTick(() => {
      updateVisiblePages()

      if (pendingAnchor.value) {
        // 保持原有微任务时序，避免晚一帧导致视觉抖动；并丢弃过时恢复任务
        const seq = ++restoreAnchorSeq
        Promise.resolve().then(() => {
          if (seq !== restoreAnchorSeq) return
          if (pendingAnchor.value) {
            // 使用纯计算模式恢复锚点，传入目标缩放比例
            // 避免读取 offsetHeight/offsetTop 等触发强制同步布局
            restoreAnchor(pendingAnchor.value, pdfStore.scale)
            clearPendingAnchor()
          }
        })
      }
      settleZooming()
    })
  }
)

let lastUserTriggeredPage = 1
watch(
  () => pdfStore.currentPage,
  (page, oldPage) => {
    if (page !== oldPage && page !== lastUserTriggeredPage) {
      lastUserTriggeredPage = page
      setCurrentPageForRender(page) // 更新渲染范围中心页面
      scrollToPage(page, true)
    }
  }
)

watch(
  () => pdfStore.selectedText,
  (newText) => {
    if (!newText) {
      window.getSelection()?.removeAllRanges()
      showTooltip.value = false
    }
  }
)

// 监听内部链接点击事件
window.addEventListener('pdf-internal-link', ((event: CustomEvent<{ 
  destCoords: { page: number; x: number | null; y: number | null; zoom: number | null; type: string }
  clickX: number
  clickY: number
  sourceText?: string
}>) => {
  const { destCoords, clickX, clickY, sourceText } = event.detail
  // 显示弹窗而不是直接跳转，弹窗位置在点击位置右侧下方
  const popupX = Math.min(clickX + 10, window.innerWidth - 280)
  const popupY = Math.min(clickY + 10, window.innerHeight - 200)
  
  // 解析目标段落 ID，把源文本传进去
  const targetParagraph = getParagraphByCoords(
    destCoords.page, 
    destCoords.x, 
    destCoords.y, 
    pdfStore.paragraphs,
    sourceText
  )
  
  pdfStore.openInternalLinkPopup(destCoords, { x: popupX, y: popupY }, targetParagraph?.id || null)
}) as EventListener)

// ========================= 埋点：reading_started + page_viewed + reading_session_ended =========================
let _readingStarted = false
let _readingTimer: ReturnType<typeof setTimeout> | null = null
let _scrollDetected = false
let _sessionStartTime = 0
let _activeTime = 0
const _viewedPages = new Set<string>() // "docId:page" 避免重复上报

function _onScrollForReading() { _scrollDetected = true }

function _checkReadingStarted() {
  if (_readingStarted || !pdfStore.activeReaderId) return
  if (_scrollDetected) {
    _readingStarted = true
    trackEvent('reading_started', {
      paper_id: pdfStore.activeReaderId,
      page_number: pdfStore.currentPage,
      page_name: 'reader_page',
      module_name: 'pdf_reader',
    })
  }
}

// page_viewed：currentPage 变化后停留 >2s 视为真正查看
let _pageViewTimer: ReturnType<typeof setTimeout> | null = null
watch(() => pdfStore.currentPage, (page) => {
  if (_pageViewTimer) clearTimeout(_pageViewTimer)
  _pageViewTimer = setTimeout(() => {
    const key = `${pdfStore.activeReaderId}:${page}`
    if (pdfStore.activeReaderId && !_viewedPages.has(key)) {
      _viewedPages.add(key)
      trackEvent('page_viewed', {
        paper_id: pdfStore.activeReaderId,
        page_number: page,
        page_name: 'reader_page',
        module_name: 'pdf_reader',
      })
    }
  }, 2000)
})

// 活跃时间追踪 — 心跳超时状态机（用于 reading_session_ended + reading_progress_updated）
// 任何交互后信任用户在接下来 30s 内都在阅读，30s 无交互则切为 idle
const _ACTIVE_TIMEOUT = 30_000 // 30s 超时阈值
let _isActive = false
let _activeStartedAt = 0
let _idleTimer: ReturnType<typeof setTimeout> | null = null

function _flushActiveSegment() {
  if (_isActive && _activeStartedAt) {
    _activeTime += Date.now() - _activeStartedAt
    pdfStore.updateActiveReadingTime(_activeTime)
    _activeStartedAt = 0
  }
  _isActive = false
}

function _onUserActivity() {
  // 切后台时不算活跃
  if (document.hidden) return

  if (!_isActive) {
    // idle → active：开始新的活跃段
    _isActive = true
    _activeStartedAt = Date.now()
  }
  // 重置超时倒计时
  if (_idleTimer) clearTimeout(_idleTimer)
  _idleTimer = setTimeout(() => {
    // 超时：将最后一次交互到超时点之间的时间算作活跃，然后切为 idle
    _flushActiveSegment()
  }, _ACTIVE_TIMEOUT)
}

function _onVisibilityChange() {
  if (document.hidden) {
    // 切后台：立即结算活跃段
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null }
    _flushActiveSegment()
  } else {
    // 切回前台：视为一次交互
    _onUserActivity()
  }
}

function _sendSessionEnd() {
  if (!_sessionStartTime || !pdfStore.activeReaderId) return
  // 结算当前活跃段
  _flushActiveSegment()
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null }
  const foreground = Date.now() - _sessionStartTime
  const idle = foreground - _activeTime
  trackEvent('reading_session_ended', {
    paper_id: pdfStore.activeReaderId,
    foreground_duration: Math.round(foreground / 1000),
    active_duration: Math.round(_activeTime / 1000),
    idle_duration: Math.round(idle / 1000),
    page_name: 'reader_page',
  })
  flushEvents()
}

// ------------------------- 生命周期 -------------------------
onMounted(() => {
  window.addEventListener('reader-zoom-wheel', handleExternalZoomWheel as EventListener)

  // 埋点：初始化阅读追踪
  _sessionStartTime = Date.now()
  _activeTime = 0
  _isActive = false
  _activeStartedAt = 0
  _readingStarted = false
  _scrollDetected = false
  containerRef.value?.addEventListener('scroll', _onScrollForReading, { passive: true })
  _readingTimer = setInterval(_checkReadingStarted, 10_000) // 每 10s 检查
  // 心跳事件：mousemove / keydown / wheel / click + visibilitychange
  document.addEventListener('mousemove', _onUserActivity, { passive: true })
  document.addEventListener('keydown', _onUserActivity, { passive: true })
  document.addEventListener('wheel', _onUserActivity, { passive: true })
  document.addEventListener('click', _onUserActivity, { passive: true })
  document.addEventListener('visibilitychange', _onVisibilityChange)
  window.addEventListener('pagehide', _sendSessionEnd)

  nextTick(async () => {
    if (!containerRef.value) return

    // 如果持久化存储中已经有了该文档的总页数，立即初始化页码数据
    // 这样在 PDF.js 还没加载完文件时，用户就能看到页面框架（骨架屏）
    if (pdfStore.totalPages > 0 && pageNumbers.value.length === 0) {
      if (pdfStore.pageSizesConstant) pageSizesConstant.value = pdfStore.pageSizesConstant
      if (pdfStore.pageSizesArray) pageSizesArray.value = pdfStore.pageSizesArray
      pageNumbers.value = Array.from({ length: pdfStore.totalPages }, (_, index) => index + 1)
    }

    // PDF hydration 由 MainLayout 统一处理，PdfViewer 通过 watcher 响应 currentPdfUrl 变化

    resizeObserver = new ResizeObserver(() => {
      if (!isResizing.value && pdfDoc.value) {
        isResizing.value = true
      }

      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        if (isResizing.value) {
          updateVisiblePages()
          isResizing.value = false
        }
      }, 150)
    })

    resizeObserver.observe(containerRef.value)
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('reader-zoom-wheel', handleExternalZoomWheel as EventListener)

  // 埋点：结束阅读会话
  _sendSessionEnd()
  if (_readingTimer) clearInterval(_readingTimer)
  if (_pageViewTimer) clearTimeout(_pageViewTimer)
  containerRef.value?.removeEventListener('scroll', _onScrollForReading)
  document.removeEventListener('mousemove', _onUserActivity)
  document.removeEventListener('keydown', _onUserActivity)
  document.removeEventListener('wheel', _onUserActivity)
  document.removeEventListener('click', _onUserActivity)
  document.removeEventListener('visibilitychange', _onVisibilityChange)
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null }
  window.removeEventListener('pagehide', _sendSessionEnd)

  restoreAnchorSeq += 1
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (resizeTimeout) {
    clearTimeout(resizeTimeout)
    resizeTimeout = null
  }
  cleanup()
})
</script>

<template>
  <div class="pdf-viewer-root flex flex-col h-full bg-slate-50/50 dark:bg-[#0b1220] relative" :style="readerPopupStyleVars">

    <div
      v-if="pdfStore.currentPdfUrl"
      ref="containerRef"
      class="pdf-scroll-container flex-1 overflow-auto p-4"
      :class="{ 'links-disabled': linksDisabled }"
      @mouseenter="handleMouseEnterContainer"
      @mouseleave="handleMouseLeaveContainer"
      @mousedown="handleMouseDown"
      @mouseup="handleMouseUp"
      @mousemove="handleMouseMove"
      @wheel="handleWheel"
      @scroll="handleScroll"
    >
      <div class="space-y-4 flex flex-col items-center w-fit min-w-full mx-auto">
        <div
          v-for="page in pageNumbers"
          :key="page"
          class="pdf-page-row flex items-stretch gap-4 shrink-0"
          :style="getPageRowStyle(page)"
        >
          <div
            class="pdf-page relative bg-white dark:bg-[#111827] shadow-none outline outline-1 outline-primary-100/60 dark:outline-slate-800/60 overflow-hidden shrink-0"
            :class="{ 'zooming': isZooming }"
            :ref="(el) => handlePageContainerRef(page, el)"
            :data-page="page"
            :style="{
              width: getScaledPageSize(page, pdfStore.scale, pageSizesConstant, pageSizesArray).width + 'px',
              height: getScaledPageSize(page, pdfStore.scale, pageSizesConstant, pageSizesArray).height + 'px'
            }"
          >
          <div
            v-if="shouldRenderPageContent(page) && !isPageRendered(page)"
            class="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#0f172a] z-10"
          >
            <div class="loading-spinner mb-3"></div>
            <span class="text-gray-400 text-sm">{{ page }}</span>
          </div>
          
          <!-- 翻译控制 -->
          <div class="absolute top-2 left-2 z-20 flex flex-col gap-2 transition-opacity duration-500"
            v-if="shouldRenderPageContent(page) && isPageRendered(page)"
               :class="{ 'opacity-0 pointer-events-none': !pdfStore.activeReaderId || (paragraphsByPage.get(page) || []).length === 0 }">
            <!-- 按页预翻译按钮 -->
            <div class="flex items-center gap-1 w-fit">
              <button
                @click="handlePageTranslateClick(page)"
                class="p-1.5 bg-white/80 dark:bg-[#1f2937]/80 hover:bg-white dark:hover:bg-[#374151] rounded shadow-sm border border-gray-200 dark:border-gray-700 backdrop-blur-sm transition-colors text-gray-500 hover:text-primary-500 dark:text-gray-400 dark:hover:text-primary-400 disabled:opacity-50 disabled:cursor-not-allowed"
                :title="'翻译第' + page + '页'"
                :disabled="pdfStore.pageTranslationStatus[page] === 'loading' || pdfStore.pageTranslationStatus[page] === 'pending' || isPageFullyCachedByFrontend(page)"
              >
                <svg v-if="pdfStore.pageTranslationStatus[page] === 'loading'" class="w-4 h-4 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <svg v-else-if="pdfStore.pageTranslationStatus[page] === 'success' || isPageFullyCachedByFrontend(page)" class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                <svg v-else-if="pdfStore.pageTranslationStatus[page] === 'failed'" class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                <svg v-else class="w-4 h-4" :class="pdfStore.pageTranslationStatus[page] === 'pending' ? 'text-gray-400' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 
            虚拟滚动优化：
            - 页面容器始终渲染（保持滚动高度）
            - 只有"当前页面±10页"和"已访问页面±1页"范围内的页面才渲染完整内容
            - 不在范围内的页面只保留空白容器，不渲染canvas、textLayer等
          -->
          <canvas v-if="shouldRenderPageContent(page)" class="absolute top-0 left-0" />
          
          <div v-if="shouldRenderPageContent(page)" class="highlightLayer absolute inset-0 pointer-events-none" :class="{ 'zooming-layer': isZooming }">
            <template v-for="hl in highlightsByPage.get(page) || []" :key="hl.id">
              <div
                v-for="(rect, idx) in hl.rects"
                :key="`${hl.id}-${idx}`"
                class="highlight-rect absolute pointer-events-none"
                :style="{
                  left: `${rect.left * 100}%`,
                  top: `${rect.top * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                  backgroundColor: getHighlightColor(hl.color)
                }"
              />
              <div
                v-if="pdfStore.selectedHighlight?.id === hl.id"
                class="highlight-selected-box absolute pointer-events-none"
                :style="getBoundingBoxStyle(hl.rects)"
              />
            </template>
          </div>
          
          <div v-if="shouldRenderPageContent(page)" class="layoutOverlayLayer absolute inset-0 pointer-events-none" :class="{ 'zooming-layer': isZooming }">
            <div
              v-for="overlay in layoutOverlaysByPage.get(page) || []"
              :key="overlay.id"
              class="layout-overlay-hitbox absolute pointer-events-auto"
              :style="getLayoutOverlayStyle(overlay)"
              @mouseenter="setHoveredOverlay(overlay.id)"
              @mouseleave="setHoveredOverlay(null)"
            >
              <div
                v-show="isOverlayHovered(overlay.id) || isOverlayChatOpen(overlay.id)"
                class="layout-overlay-rect absolute inset-0"
                :class="getLayoutOverlayClass(overlay.kind)"
              >
                <div class="layout-overlay-actions">
                  <button
                    type="button"
                    class="layout-overlay-action-btn"
                    @click.stop="requestOverlayExplanation(overlay)"
                  >
                    Explain
                  </button>
                  <button
                    type="button"
                    class="layout-overlay-action-btn"
                    @click.stop="copyOverlayImage(overlay)"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div
                v-if="isOverlayChatOpen(overlay.id)"
                class="layout-overlay-chat-panel popup-surface popup-surface--floating"
                :class="getOverlayChatPanelClass(overlay)"
                :style="getOverlayChatPanelStyle(overlay.page)"
                @mouseenter="setHoveredOverlay(overlay.id)"
                @mousedown.stop
                @mouseup.stop
                @mousemove.stop
                @click.stop
              >
                <div class="layout-overlay-chat-header popup-header">
                  <span class="layout-overlay-chat-title popup-title">Region Chat</span>
                  <button type="button" class="layout-overlay-chat-close popup-icon-btn" @click.stop="closeOverlayChat()" aria-label="Close region chat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="layout-overlay-chat-close-icon">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <img
                  v-if="activeOverlayChat?.imageDataUrl"
                  :src="activeOverlayChat.imageDataUrl"
                  class="layout-overlay-chat-image popup-card"
                />
                <div class="layout-overlay-chat-messages popup-scroll">
                  <div
                    v-for="(message, msgIndex) in activeOverlayChat?.messages || []"
                    :key="msgIndex"
                    class="layout-overlay-chat-message markdown-body prose prose-sm max-w-none"
                    :class="message.role === 'user' ? 'is-user' : 'is-assistant'"
                    v-html="renderMarkdown(message.content)"
                  ></div>
                  <div v-if="activeOverlayChat?.loading" class="layout-overlay-chat-loading">Analyzing...</div>
                  <div v-if="activeOverlayChat?.error" class="layout-overlay-chat-error">{{ activeOverlayChat.error }}</div>
                </div>
                <div class="layout-overlay-chat-input-row">
                  <input
                    v-model="activeOverlayChat!.draft"
                    type="text"
                    class="layout-overlay-chat-input popup-input"
                    placeholder="Ask about this region..."
                    @mousedown.stop
                    @mouseup.stop
                    @click.stop
                    @keydown.stop
                    @keydown.enter.prevent="sendOverlayChatMessage()"
                  />
                  <button
                    type="button"
                    class="layout-overlay-chat-send popup-button"
                    :disabled="!activeOverlayChat?.draft?.trim() || !!activeOverlayChat?.loading"
                    @mousedown.stop
                    @mouseup.stop
                    @click.stop="sendOverlayChatMessage()"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div v-if="shouldRenderPageContent(page)" class="textLayer absolute inset-0" :class="{ 'zooming-layer': isZooming }" />
          <div v-if="shouldRenderPageContent(page)" class="linkLayer absolute inset-0" :class="{ 'zooming-layer': isZooming }" />
          
          <div
            v-if="shouldRenderPageContent(page) && pdfStore.activeReaderId && (paragraphsByPage.get(page) || []).length > 0"
            class="paragraphMarkerLayer absolute inset-0 pointer-events-none z-10" :class="{ 'zooming-layer': isZooming }">
            <div
              v-for="paragraph in paragraphsByPage.get(page) || []"
              :key="`hl-${paragraph.id}`"
              v-show="translationStore.hoveredParagraphId === paragraph.id && paragraph.bbox"
              class="paragraph-hover-overlay absolute pointer-events-none"
              :style="paragraph.bbox ? {
                left: `${(paragraph.bbox.x0 / (getPageSize(page, pageSizesConstant, pageSizesArray)?.width || 1)) * 100}%`,
                top: `${(paragraph.bbox.y0 / (getPageSize(page, pageSizesConstant, pageSizesArray)?.height || 1)) * 100}%`,
                width: `${((paragraph.bbox.x1 - paragraph.bbox.x0) / (getPageSize(page, pageSizesConstant, pageSizesArray)?.width || 1)) * 100}%`,
                height: `${((paragraph.bbox.y1 - paragraph.bbox.y0) / (getPageSize(page, pageSizesConstant, pageSizesArray)?.height || 1)) * 100}%`,
              } : {}"
            ></div>
            <div
              v-for="paragraph in paragraphsByPage.get(page) || []"
              :key="paragraph.id"
              :data-paragraph-id="paragraph.id"
              class="paragraph-marker absolute pointer-events-auto cursor-pointer"
              :class="{
                'is-translated': hasFrontendCachedTranslation(paragraph),
                'is-translating': pdfStore.pageTranslationStatus[page] === 'loading' && !hasFrontendCachedTranslation(paragraph),
                'is-hovered': translationStore.hoveredParagraphId === paragraph.id
              }"
              :style="getParagraphMarkerStyle(paragraph, getPageSize(page, pageSizesConstant, pageSizesArray))"
              @click="handleParagraphMarkerClick($event, paragraph.id, paragraph.content)"
              @mouseenter="translationStore.setHoveredParagraph(paragraph.id)"
              @mouseleave="translationStore.setHoveredParagraph(null)"
              :title="hasFrontendCachedTranslation(paragraph) ? 'Translation available. Click to view.' : 'Click to translate this paragraph.'"
            >
              <div class="marker-icon">
                <span class="marker-chevron">&gt;</span>
              </div>
            </div>
          </div>
          </div>

          <PageTranslationSidebar
            v-if="pdfStore.showFullTranslationSidebar"
            :pdf-id="pdfStore.activeReaderId"
            :page="page"
            :scale="pdfStore.scale"
            :page-status="pdfStore.pageTranslationStatus[page]"
            :full-status="pdfStore.fullTranslationStatus"
            :width="getPageTranslationSidebarWidth(page)"
            :paragraphs="getPageTranslationSidebarParagraphs(page)"
            :is-zooming="isZooming"
          />
        </div>
      </div>
    </div>

    <div
      v-else
      class="flex-1 flex flex-col items-center justify-center text-gray-400"
    >
      <svg class="w-24 h-24 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <h2 class="text-xl font-medium mb-2">Start Reading</h2>
      <p class="text-sm">Upload a PDF from the left sidebar to begin.</p>
    </div>

    <TextSelectionTooltip
      v-if="showTooltip && pdfStore.selectedText"
      :position="tooltipPosition"
      :text="pdfStore.selectedText"
      :mode="pdfStore.isEditingHighlight ? 'highlight' : 'selection'"
      :highlight="pdfStore.selectedHighlight"
      @close="closeTooltip"
    />
    
    <TranslationPanel />
    <NotePreviewCard />
    <InternalLinkPopup />
  </div>
</template>

<style scoped>
.pdf-page-row {
  align-items: stretch;
}

.pdf-page {
  border-radius: var(--radius-xl);
}

.highlightLayer {
  z-index: 5;
  pointer-events: none;
}

.layoutOverlayLayer {
  z-index: 6;
  pointer-events: none;
}

.layout-overlay-hitbox {
  pointer-events: auto;
}

.linkLayer {
  z-index: 3;
  pointer-events: none;
}

.links-disabled :deep(.linkLayer),
.links-disabled :deep(.linkLayer a),
.links-disabled :deep(.linkLayer .internal-link) {
  pointer-events: none !important;
}

.highlight-rect {
  background: var(--c-highlight);
  border-radius: var(--radius-sm);
}

.highlight-selected-box {
  border: 1.5px dashed var(--c-text-secondary);
  box-shadow: 0 0 4px rgba(0,0,0,0.1);
  background-color: transparent;
  z-index: 2;
  box-sizing: border-box;
}

.layout-overlay-rect {
  border: var(--border-width-2) solid;
  border-radius: var(--radius-sm);
  box-sizing: border-box;
  pointer-events: auto;
}

.layout-overlay-actions {
  position: absolute;
  right: var(--space-1);
  bottom: var(--space-1);
  display: flex;
  gap: var(--space-1);
}

.layout-overlay-action-btn {
  font-size: var(--popup-button-size);
  line-height: 1;
  padding: 3px var(--space-1-5);
  border-radius: var(--radius-sm);
  border: var(--border-width) solid rgba(15, 23, 42, 0.25);
  background: rgba(255, 255, 255, 0.95);
  color: var(--c-text-heading);
  cursor: pointer;
}

.layout-overlay-action-btn:hover {
  background: var(--c-bg-primary);
}

.layout-overlay-chat-panel {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 0;
  display: flex;
  flex-direction: column;
  gap: var(--popup-gap);
  padding: var(--space-2-5);
  pointer-events: auto;
  z-index: var(--z-dropdown);
  font-size: var(--popup-text-size);
  overflow: hidden;
}

.layout-overlay-chat-panel.open-up {
  top: auto;
  bottom: calc(100% + var(--space-2));
}

.layout-overlay-chat-panel.open-left {
  left: auto;
  right: 0;
}

.layout-overlay-chat-header {
  margin: calc(-1 * var(--space-2-5)) calc(-1 * var(--space-2-5)) 0;
  flex-shrink: 0;
}

.layout-overlay-chat-close-icon {
  width: 14px;
  height: 14px;
}

.layout-overlay-chat-image {
  width: 100%;
  max-height: 96px;
  object-fit: contain;
  flex-shrink: 0;
  background: var(--c-bg-secondary);
}

.layout-overlay-chat-messages {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1-5);
  overflow: auto;
  min-height: 0;
}

.layout-overlay-chat-message {
  font-size: var(--popup-text-size);
  line-height: var(--popup-line-height);
  padding: var(--space-2) var(--space-2-5);
  border-radius: var(--radius-lg);
  white-space: normal;
}

.layout-overlay-chat-message.is-user {
  background: var(--c-border);
  color: var(--c-text-primary);
}

.layout-overlay-chat-message.is-assistant {
  background: var(--c-bg-panel);
  color: var(--c-text-primary);
}

.layout-overlay-chat-loading {
  font-size: var(--popup-muted-size);
  color: var(--c-text-tertiary);
}

.layout-overlay-chat-error {
  font-size: var(--popup-muted-size);
  color: var(--c-error);
}

.layout-overlay-chat-input-row {
  display: flex;
  gap: var(--popup-gap);
  flex-shrink: 0;
}

.layout-overlay-chat-input {
  flex: 1;
  min-width: 0;
}

.layout-overlay-chat-send {
  padding: var(--popup-input-padding-y) var(--popup-padding);
}

.layout-overlay-image {
  border-color: rgba(34, 197, 94, 0.95);
  background: rgba(34, 197, 94, 0.12);
}

.layout-overlay-table {
  border-color: rgba(147, 51, 234, 0.95);
  background: rgba(147, 51, 234, 0.12);
}

.layout-overlay-formula {
  border-color: rgba(14, 165, 233, 0.95);
  background: rgba(14, 165, 233, 0.12);
}

:deep(.linkLayer a),
:deep(.linkLayer .internal-link) {
  pointer-events: auto;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--c-border);
  border-top-color: var(--c-text-tertiary);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}

.paragraph-hover-overlay {
  z-index: 6;
  background-color: rgba(80, 140, 255, 0.08);
  border-radius: 3px;
  transition: opacity 0.2s ease;
}

:global(.dark) .paragraph-hover-overlay {
  background-color: rgba(251, 191, 96, 0.1);
}

.paragraphMarkerLayer {
  z-index: 7;
}

.paragraph-marker {
  z-index: 8;
}

.paragraph-marker .marker-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  transition: all var(--duration-normal) var(--ease-default);
  opacity: 0.5;
}

.paragraph-marker .marker-chevron {
  font-size: 16px;
  font-weight: var(--font-semibold);
  font-family: var(--font-mono);
  color: rgba(100, 140, 200, 0.8);
  line-height: 1;
  transition: all var(--duration-normal) var(--ease-default);
}

.paragraph-marker:hover .marker-icon,
.paragraph-marker.is-hovered .marker-icon {
  opacity: 1;
  transform: scale(1.2) translateX(2px);
}

.paragraph-marker:hover .marker-chevron,
.paragraph-marker.is-hovered .marker-chevron {
  color: rgba(80, 140, 255, 0.8);
}

.paragraph-marker.is-translated .marker-chevron {
  color: rgba(34, 197, 94, 0.85);
}

.paragraph-marker.is-translated:hover .marker-chevron {
  color: rgba(22, 163, 74, 1);
}

.paragraph-marker.is-translating .marker-chevron {
  color: rgba(251, 146, 60, 0.8);
  animation: translating-pulse 1.2s ease-in-out infinite;
}

@keyframes translating-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

:global(.dark) .paragraph-marker .marker-chevron {
  color: rgba(140, 180, 255, 0.7);
}

:global(.dark) .paragraph-marker:hover .marker-chevron,
:global(.dark) .paragraph-marker.is-hovered .marker-chevron {
  color: rgba(160, 200, 255, 0.8);
}

:global(.dark) .paragraph-marker.is-translated .marker-chevron {
  color: rgba(74, 222, 128, 0.85);
}

:global(.dark) .paragraph-marker.is-translated:hover .marker-chevron {
  color: rgba(134, 239, 172, 1);
}

:global(.dark) .paragraph-marker.is-translating .marker-chevron {
  color: rgba(251, 146, 60, 0.8);
}

.zooming-layer {
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-default);
  /* 缩放期间启用硬件加速 */
  will-change: transform;
}

/* 缩放期间临时优化 canvas 渲染性能 */
.pdf-page.zooming canvas {
  will-change: width, height;
  /* 缩放时降低图像质量以提升性能 */
  image-rendering: auto;
}

:global(.dark .pdf-viewer-root) {
  background: var(--c-pdf-viewer-bg);
}

:global(.dark .pdf-scroll-container) {
  background: var(--c-pdf-viewer-bg);
}

:global(.dark .pdf-page) {
  background-color: var(--c-pdf-bg) !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}

:global(.dark .pdf-page canvas) {
  background-color: var(--c-pdf-bg);
  filter: invert(0.92) hue-rotate(180deg) brightness(1.05);
}

:global(.dark .highlight-selected-box) {
  border-color: #cbd5ff;
}

:global(.dark .loading-spinner) {
  border-color: var(--c-border);
  border-top-color: var(--c-text-muted);
}

/* PDF scrollbar */
:global(.pdf-scroll-container::-webkit-scrollbar) {
  width: var(--scrollbar-width);
}

:global(.pdf-scroll-container::-webkit-scrollbar-track) {
  background: var(--c-scrollbar-track);
}

:global(.pdf-scroll-container::-webkit-scrollbar-thumb) {
  background: var(--c-scrollbar-thumb);
  border-radius: var(--radius-md);
}

:global(.pdf-scroll-container::-webkit-scrollbar-thumb:hover) {
  background: var(--c-scrollbar-hover);
}

.textLayer {
  z-index: 2;
  pointer-events: auto;
}

:deep(.textLayer) {
  opacity: 1;
}

:global(.dark .textLayer),
:global(.dark .textLayer span) {
  color: transparent !important;
  mix-blend-mode: normal;
}

:deep(.textLayer span) {
  display: inline-block;
  padding: 5px 0;
  margin: -5px 0;
  line-height: 1.0 !important;
  letter-spacing: 0.2px !important;
  transform-origin: 0 0;
  font-family: "Times New Roman", "Nimbus Roman No9 L", "FreeSerif", "Liberation Serif", serif !important;
  white-space: pre;
  cursor: text;
  color: transparent !important;
}

:deep(.textLayer ::selection) {
  background: var(--c-pdf-selection) !important;
}

/* slide-down transition is now in global components.css */
</style>


