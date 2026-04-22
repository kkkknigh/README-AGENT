import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import type { PdfParagraph, Highlight, NormalizedRect, InternalLinkData } from '../types'
import type { PageSize } from '../types/pdf'

// 导入解耦后的子模块逻辑
import { usePdfUiState } from './pdf-ui'
import { usePdfTranslationState } from './pdf-translation'
import { pdfApi, linkApi, type PdfLayoutResponse } from '../api'
import { STORES, dbPut, dbGet, dbGetMany, dbUpdate } from '../utils/db'
import { updateReceivedUpToPage } from '../composables/queries/usePdfQueries'
import { useTranslationStore } from './translation'
import { useQueryClient } from '@tanstack/vue-query'
import { trackEvent } from '../utils/tracking'

// 实际缩放 150%，显示为 100%
const DEFAULT_SCALE = 1.5

export type { Highlight, NormalizedRect }

type LayoutOverlayKind = 'image' | 'table' | 'formula'
type LayoutOverlay = {
  id: string
  page: number
  kind: LayoutOverlayKind
  bboxNorm: {
    left: number
    top: number
    width: number
    height: number
  }
}

export const usePdfStore = defineStore('pdf', () => {
  // ---------------------- 实例化解耦后的子模块 ----------------------
  const ui = usePdfUiState()
  const translation = usePdfTranslationState()
  const translationStore = useTranslationStore()
  const queryClient = useQueryClient()

  // ---------------------- 可观察的状态（state） ----------------------
  const currentPdfUrl = ref<string | null>(null) // 当前打开的 PDF 文件 URL
  const activeReaderId = useStorage<string | null>('readme_pdf_active_reader_id', null, sessionStorage) // 当前文档 ID (per-tab)
  const currentPage = useStorage<number>('readme_pdf_current_page', 1, sessionStorage) // 当前页码（从 1 开始）
  const totalPages = useStorage<number>('readme_pdf_total_pages', 0, sessionStorage) // 文档总页数
  const scale = useStorage<number>('readme_pdf_scale', DEFAULT_SCALE, sessionStorage) // 当前缩放比例
  const isLoading = ref(false) // 文档加载中标志

  // 自动相关开关
  const autoHighlight = ref(false)
  const autoTranslate = ref(false)
  const imageDescription = ref(false)

  // 文字选择相关信息
  const selectedText = ref<string>('')
  const selectionPosition = ref<{ x: number; y: number } | null>(null)
  const selectionInfo = ref<{ page: number; rects: NormalizedRect[] } | null>(null)

  // 存储数据
  const allParagraphs = ref<Record<string, PdfParagraph[]>>({})
  const allLayoutOverlays = ref<Record<string, LayoutOverlay[]>>({})
  const pageSizesConstant = useStorage<PageSize | null>('readme_pdf_page_sizes_constant', null, sessionStorage)
  const pageSizesArray = useStorage<PageSize[] | null>('readme_pdf_page_sizes_array', null, sessionStorage)

  const highlightColor = ref('#F6E05E')
  const selectedHighlight = ref<Highlight | null>(null)
  const isEditingHighlight = ref(false)
  const showFullTranslationSidebar = ref(false)

  // ---------------------- 计算属性 ----------------------
  const paragraphs = computed(() => {
    if (!activeReaderId.value) return []
    return allParagraphs.value[activeReaderId.value] || []
  })

  const layoutOverlays = computed(() => {
    if (!activeReaderId.value) return []
    return allLayoutOverlays.value[activeReaderId.value] || []
  })

  const scalePercent = computed(() => Math.round((scale.value / DEFAULT_SCALE) * 100))

  /**
   * 将段落中携带的引用信息预热到 Vue Query 缓存中，实现秒开引用弹窗
   */
  function prewarmLinkCache(pdfId: string, paragraphsData: PdfParagraph[]) {
    for (const p of paragraphsData) {
      if (p.id && p.citationInfo && p.citationInfo.valid === 1) {
        // 同步到 Vue Query 缓存，Key 与 useInternalLinkQuery 保持一致
        queryClient.setQueryData(['link-data', pdfId, p.id], p.citationInfo)
      }
    }
  }

  // 记录已预热引用的文档 ID，避免重复请求
  function syncParagraphTranslations(pdfId: string, paragraphsData: PdfParagraph[]) {
    for (const paragraph of paragraphsData) {
      if (paragraph.id && paragraph.translation) {
        translationStore.setTranslatedParagraph(paragraph.id, paragraph.translation, pdfId)
      }
    }
  }

  function ingestParagraphs(documentId: string, paragraphsData: PdfParagraph[]) {
    if (!paragraphsData.length) return
    appendParagraphs(documentId, paragraphsData)
    syncParagraphTranslations(documentId, paragraphsData)
  }

  const _warmedCitationPdfIds = new Set<string>()
  const inFlightLayoutRequests = new Map<string, Promise<void>>()

  /**
   * 全量预热该文档所有已存在的引用信息（每个文档只预热一次）
   */
  async function prewarmWholeCitations(pdfId: string) {
    if (_warmedCitationPdfIds.has(pdfId)) return
    _warmedCitationPdfIds.add(pdfId)
    const res = await linkApi.getAllCitations(pdfId)
    // 异步返回后文档可能已切换，丢弃过期数据
    if (activeReaderId.value !== pdfId) return
    if (res && res.citations) {
      Object.entries(res.citations).forEach(([paraId, info]) => {
        const citationInfo = info as InternalLinkData
        if (citationInfo && citationInfo.valid === 1) {
          queryClient.setQueryData(['link-data', pdfId, paraId], citationInfo)
        }
      })
    }
  }

  // ---------------------- 文档与页面控制 ----------------------
  async function setCurrentPdf(url: string, documentId?: string) {
    // 防闪烁：如果是同一个文档且 URL 也没变，或者是正在加载同一个文档，直接返回
    if (documentId === activeReaderId.value && url === currentPdfUrl.value && url !== '') {
      return
    }

    clearSelection()
    clearHighlightSelection()

    // 释放旧的 Blob URL 以防止内存泄漏
    if (currentPdfUrl.value && currentPdfUrl.value.startsWith('blob:') && currentPdfUrl.value !== url) {
      // 检查 libraryStore 的缓存，如果在其中则不手动 revoke
      const libraryStore = (await import('./library')).useLibraryStore()
      const isCached = Array.from((libraryStore as any).blobUrlCache.values()).includes(currentPdfUrl.value)
      if (!isCached) {
        // 延迟释放，防止 PDF.js Worker 线程在切换时报错 ERR_FILE_NOT_FOUND
        const oldUrl = currentPdfUrl.value
        setTimeout(() => {
          URL.revokeObjectURL(oldUrl)
        }, 3000)
      }
    }

    const isDifferentDoc = activeReaderId.value !== (documentId || null)
    const previousDocId = activeReaderId.value
    currentPdfUrl.value = url

    if (isDifferentDoc) {
      activeReaderId.value = documentId || null
      currentPage.value = 1
      scale.value = DEFAULT_SCALE
      translation.pageTranslationStatus.value = {}
      translation.fullTranslationStatus.value = 'idle'
      // 重置阅读进度里程碑
      _reportedMilestones.clear()
      _activeReadingTimeMs.value = 0
    }
    isLoading.value = true

    // 同步拉取段落数据（如果已指定 ID）
    if (documentId) {
      // IDB 命中则直接水合 store；miss 时由 usePdfStatusQuery 统一轮询后端
      await hydrateDocumentFromIdb(documentId)
    }

    // 子模块状态已在 isDifferentDoc 分支中按需重置

    // 埋点：paper_opened + continue_previous_paper
    if (documentId && url) {
      trackEvent('paper_opened', {
        paper_id: documentId,
        page_name: 'reader_page',
        module_name: 'pdf_reader',
      })
      // 如果之前打开过某篇论文又回到同一篇，视为 continue
      if (!isDifferentDoc && previousDocId === documentId) {
        trackEvent('continue_previous_paper', { paper_id: documentId })
      }
    }
  }

  function setTotalPages(pages: number) {
    totalPages.value = pages
    isLoading.value = false
  }

  function goToPage(page: number) {
    if (page >= 1 && page <= totalPages.value) {
      currentPage.value = page
    }
  }

  function nextPage() { goToPage(currentPage.value + 1) }
  function prevPage() { goToPage(currentPage.value - 1) }

  function zoomIn() { if (scale.value < 4.5) scale.value = Math.min(4.5, scale.value + 0.1) }
  function zoomOut() { if (scale.value > 0.5) scale.value = Math.max(0.5, scale.value - 0.1) }

  function setScale(value: number) { scale.value = Math.max(0.5, Math.min(4.5, value)) }
  function setScalePercent(percent: number) { setScale((percent / 100) * DEFAULT_SCALE) }

  // ---------------------- 文本选择与高亮功能 ----------------------
  function setSelectedText(text: string, position?: { x: number; y: number }) {
    selectedText.value = text
    selectionPosition.value = position || null
  }

  function setSelectionInfo(info: { page: number; rects: NormalizedRect[] } | null) {
    selectionInfo.value = info
  }

  function clearSelection() {
    selectedText.value = ''
    selectionPosition.value = null
    selectionInfo.value = null
  }

  function getHighlightsByPage(highlights: Highlight[], page: number) {
    return highlights.filter(h => h.page === page)
  }

  function setHighlightColor(color: string) { highlightColor.value = color }

  function selectHighlight(highlight: Highlight, position: { x: number; y: number }) {
    selectedHighlight.value = highlight
    isEditingHighlight.value = true
    selectedText.value = highlight.text
    selectionPosition.value = position
  }

  function clearHighlightSelection() {
    selectedHighlight.value = null
    isEditingHighlight.value = false
  }

  function getHighlightsAtPoint(highlights: Highlight[], page: number, x: number, y: number): Highlight[] {
    return highlights.filter(h => {
      if (h.page !== page) return false
      return h.rects.some(rect => x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height)
    })
  }

  function removeDocumentHighlights(documentId: string) {
    import('../utils/broadcast').then(({ broadcastSync }) => broadcastSync('RELOAD_HIGHLIGHTS', documentId))
  }

  // ---------------------- 其他逻辑封装 ----------------------
  function toggleAutoHighlight() { autoHighlight.value = !autoHighlight.value }
  function toggleAutoTranslate() { autoTranslate.value = !autoTranslate.value }
  function toggleImageDescription() { imageDescription.value = !imageDescription.value }

  /**
   * 从 IndexedDB 预水合文档数据（段落、翻译、高亮、摘要），
   * 不依赖 PDF Blob，可在 Blob 加载前调用以提前渲染段落。
   * 返回 true 表示成功水合了段落数据。
   */
  async function hydrateDocumentFromIdb(documentId: string): Promise<boolean> {
    // 内存中已有段落 — 直接标记 completed
    const cachedParagraphs = allParagraphs.value[documentId]
    if (cachedParagraphs && cachedParagraphs.length > 0) {
      if (!queryClient.getQueryData(['pdf-status', documentId])) {
        const maxPage = Math.max(...cachedParagraphs.map(p => p.page))
        queryClient.setQueryData(['pdf-status', documentId], {
          status: 'completed', paragraphs: [], layout: null, currentPage: maxPage,
        })
      }
      return true
    }

    // 从 IDB 恢复段落
    try {
      const idbData = await dbGet<{ id: string; paragraphs: PdfParagraph[]; layout?: any[] }>(STORES.PDF_PARAGRAPHS, documentId)
      if (!idbData?.paragraphs?.length) return false

      allParagraphs.value[documentId] = idbData.paragraphs
      syncParagraphTranslations(documentId, idbData.paragraphs)
      prewarmLinkCache(documentId, idbData.paragraphs)

      // 恢复 layout overlays
      if (idbData.layout?.length) {
        allLayoutOverlays.value[documentId] = idbData.layout
      }

      // 恢复翻译缓存
      const paragraphIds = idbData.paragraphs.map(p => p.id).filter(Boolean)
      if (paragraphIds.length) {
        const cachedTranslations = await dbGetMany<{ id: string; pdfId: string; translation: string }>(STORES.TRANSLATIONS, paragraphIds)
        for (const t of cachedTranslations) {
          if (t.translation) {
            translationStore.setTranslatedParagraph(t.id, t.translation, documentId)
          }
        }
      }

      // 高亮由 useHighlightsQuery 的 queryFn 自行从 IDB 水合，
      // 此处不再 setQueryData 以避免竞态导致 queryFn 跳过 IDB 直接请求后端

      // 恢复 Brief
      const idbBrief = await dbGet<{ id: string; data: any }>(STORES.BRIEFS, documentId)
      if (idbBrief?.data) {
        queryClient.setQueryData(['brief', documentId], idbBrief.data)
      }

      // 恢复 Roadmap
      const idbRoadmap = await dbGet<{ id: string; data: any }>(STORES.ROADMAPS, documentId)
      if (idbRoadmap?.data) {
        queryClient.setQueryData(['roadmap', documentId], idbRoadmap.data)
      }

      // 段落中的 citationInfo 已通过 prewarmLinkCache 预热到 Vue Query 缓存
      // 标记为已预热，跳过 prewarmWholeCitations 的网络请求
      _warmedCitationPdfIds.add(documentId)

      // 更新进度 + 阻止 usePdfStatusQuery 轮询
      const maxPage = Math.max(...idbData.paragraphs.map(p => p.page))
      updateReceivedUpToPage(documentId, maxPage)
      queryClient.setQueryData(['pdf-status', documentId], {
        status: 'completed', paragraphs: [], layout: null, currentPage: maxPage,
      })

      return true
    } catch (e) {
      console.warn('[PDF] IDB hydration failed:', e)
      return false
    }
  }

  function setParagraphs(documentId: string, paragraphsData: PdfParagraph[]) {
    allParagraphs.value[documentId] = paragraphsData
    syncParagraphTranslations(documentId, paragraphsData)
    // 增量预热
    prewarmLinkCache(documentId, paragraphsData)
    // 持久化到 IndexedDB
    dbPut(STORES.PDF_PARAGRAPHS, { id: documentId, paragraphs: paragraphsData }).catch(console.warn)
  }

  function appendParagraphs(documentId: string, newParagraphs: PdfParagraph[]) {
    if (!newParagraphs.length) return

    const existing = allParagraphs.value[documentId] ?? []
    let hasTranslationUpdate = false

    // Deduplicate by ID AND by spatial location (page + bbox) to handle backend restarts
    const existingIds = new Set(existing.map(p => p.id))
    const getSpatialKey = (p: PdfParagraph) => {
      if (!p.bbox) return `${p.page}-null-null`
      return `${p.page}-${Math.round(p.bbox.x0)}-${Math.round(p.bbox.y0)}`
    }
    const existingLocations = new Set(existing.map(getSpatialKey))

    const toAdd = newParagraphs.filter(p => {
      const loc = getSpatialKey(p)
      if (existingIds.has(p.id) || existingLocations.has(loc)) {
        // We already have this paragraph, update its translation text if the new one has it and we don't
        const existingPara = existing.find(ep => ep.id === p.id || getSpatialKey(ep) === loc)
        if (existingPara && p.translation && existingPara.translation !== p.translation) {
          existingPara.translation = p.translation
          hasTranslationUpdate = true
        }
        return false
      }
      return true
    })

    if (!toAdd.length && !hasTranslationUpdate) {
      return
    }

    // 仅对去重后真正新增的段落预热引用缓存
    if (toAdd.length) {
      prewarmLinkCache(documentId, toAdd)
    }

    const merged = [...existing, ...toAdd]
    merged.sort((a, b) => a.page - b.page || (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0))
    allParagraphs.value[documentId] = merged
    // 持久化到 IndexedDB
    dbPut(STORES.PDF_PARAGRAPHS, { id: documentId, paragraphs: merged }).catch(console.warn)
  }

  function applyParagraphTranslation(documentId: string, paragraphId: string, translation: string) {
    if (!translation.trim()) return

    const existing = allParagraphs.value[documentId] ?? []
    const paragraphIndex = existing.findIndex((paragraph) => paragraph.id === paragraphId)
    if (paragraphIndex < 0) return

    const currentParagraph = existing[paragraphIndex]
    if (!currentParagraph) return
    if (currentParagraph.translation === translation) return

    const nextParagraphs = [...existing]
    nextParagraphs[paragraphIndex] = {
      ...currentParagraph,
      translation,
    }
    allParagraphs.value[documentId] = nextParagraphs
  }

  function getParagraphsByPage(page: number): PdfParagraph[] {
    return paragraphs.value.filter(p => p.page === page)
  }

  function getLayoutOverlaysByPage(page: number): LayoutOverlay[] {
    return layoutOverlays.value.filter(item => item.page === page)
  }

  function setPageSizes(constant: PageSize | null, array: PageSize[] | null) {
    pageSizesConstant.value = constant
    pageSizesArray.value = array
  }

  function _collectLayoutOverlays(
    kind: LayoutOverlayKind,
    items: PdfLayoutResponse['layout']['images'] | PdfLayoutResponse['layout']['tables'] | PdfLayoutResponse['layout']['formulas'],
    overlays: LayoutOverlay[],
  ) {
    items?.forEach((item, idx) => {
      if (!item || !item.bboxNorm) return
      const page = Number(item.page) || 1
      overlays.push({
        id: `${kind}-${page}-${item.index ?? idx}`,
        page,
        kind,
        bboxNorm: {
          left: item.bboxNorm.left,
          top: item.bboxNorm.top,
          width: item.bboxNorm.width,
          height: item.bboxNorm.height,
        },
      })
    })
  }

  async function fetchLayoutForPdf(pdfId: string) {
    const pendingRequest = inFlightLayoutRequests.get(pdfId)
    if (pendingRequest) {
      return pendingRequest
    }

    const task = (async () => {
      try {
        const data = await pdfApi.getLayout(pdfId)
        const overlays: LayoutOverlay[] = []
        _collectLayoutOverlays('image', data.layout.images || [], overlays)
        _collectLayoutOverlays('table', data.layout.tables || [], overlays)
        _collectLayoutOverlays('formula', data.layout.formulas || [], overlays)
        allLayoutOverlays.value[pdfId] = overlays
        // 合并 layout 到已有的 IDB 段落记录
        dbUpdate<any>(STORES.PDF_PARAGRAPHS, pdfId, { layout: overlays })
          .catch(e => console.warn('[Layout IDB] write failed:', e))
      } catch (e) {
        allLayoutOverlays.value[pdfId] = []
        console.error('Failed to fetch layout overlays', e)
      }
    })()

    inFlightLayoutRequests.set(pdfId, task)
    try {
      return await task
    } finally {
      if (inFlightLayoutRequests.get(pdfId) === task) {
        inFlightLayoutRequests.delete(pdfId)
      }
    }
  }

  function appendLayoutOverlays(documentId: string, layout: PdfLayoutResponse['layout']) {
    if (!layout) return

    const existing = allLayoutOverlays.value[documentId] ?? []
    const newOverlays: LayoutOverlay[] = []

    _collectLayoutOverlays('image', layout.images || [], newOverlays)
    _collectLayoutOverlays('table', layout.tables || [], newOverlays)
    _collectLayoutOverlays('formula', layout.formulas || [], newOverlays)

    if (!newOverlays.length) return

    // Deduplicate by ID
    const existingIds = new Set(existing.map(o => o.id))
    const toAdd = newOverlays.filter(o => !existingIds.has(o.id))

    if (toAdd.length) {
      allLayoutOverlays.value[documentId] = [...existing, ...toAdd]
    }
  }


  // 跨标签监听现由 Vue Query 处理 (invalidateQueries)

  // ---------------------- 桥接翻译与 UI 逻辑 ----------------------
  const startPagePreTranslation = (pageNumber: number) =>
    translation.startPageStreamingTranslation(pageNumber, activeReaderId.value!, allParagraphs.value)

  const startFullPreTranslation = () =>
    translation.startFullPreTranslation(activeReaderId.value!, totalPages.value, allParagraphs.value)

  const startPageStreamingTranslation = (pageNumber: number) =>
    translation.startPageStreamingTranslation(pageNumber, activeReaderId.value!, allParagraphs.value)

  // ---------------------- 埋点：阅读进度里程碑 ----------------------
  const _reportedMilestones = new Set<number>()
  // 由 PdfViewer 同步过来的活跃阅读时长（毫秒）
  const _activeReadingTimeMs = ref(0)
  function updateActiveReadingTime(ms: number) {
    _activeReadingTimeMs.value = ms
  }

  watch(currentPage, (page) => {
    if (!totalPages.value || totalPages.value <= 0) return
    const percent = Math.round((page / totalPages.value) * 100)
    for (const milestone of [10, 25, 50, 75, 90, 100]) {
      if (percent >= milestone && !_reportedMilestones.has(milestone)) {
        _reportedMilestones.add(milestone)
        trackEvent('reading_progress_updated', {
          paper_id: activeReaderId.value,
          progress_percent: milestone,
          active_reading_time_sec: Math.round(_activeReadingTimeMs.value / 1000),
          page_name: 'reader_page',
          module_name: 'pdf_reader',
        })
      }
    }
  })

  // ---------------------- 返回 Store 接口 ----------------------
  return {
    ...ui, // 展开所有 UI 相关的 state 和 actions
    currentPdfUrl,
    activeReaderId,
    currentPage,
    totalPages,
    scale,
    scalePercent,
    isLoading,
    autoHighlight,
    autoTranslate,
    imageDescription,
    selectedText,
    selectionPosition,
    selectionInfo,
    highlightColor,
    selectedHighlight,
    isEditingHighlight,
    setCurrentPdf,
    hydrateDocumentFromIdb,
    setTotalPages,
    goToPage,
    nextPage,
    prevPage,
    zoomIn,
    zoomOut,
    setScale,
    setScalePercent,
    setSelectedText,
    setSelectionInfo,
    clearSelection,
    getHighlightsByPage,
    setHighlightColor,
    selectHighlight,
    clearHighlightSelection,
    getHighlightsAtPoint,
    removeDocumentHighlights,
    toggleAutoHighlight,
    toggleAutoTranslate,
    toggleImageDescription,
    paragraphs,
    setParagraphs,
    ingestParagraphs,
    appendParagraphs,
    applyParagraphTranslation,
    getParagraphsByPage,
    layoutOverlays,
    getLayoutOverlaysByPage,
    fetchLayoutForPdf,
    setLayoutOverlays: (pdfId: string, overlays: LayoutOverlay[]) => {
      allLayoutOverlays.value[pdfId] = overlays
    },
    appendLayoutOverlays,
    prewarmWholeCitations,
    pageSizesConstant,
    pageSizesArray,
    setPageSizes,
    // 桥接翻译状态
    pageTranslationStatus: translation.pageTranslationStatus,
    fullTranslationStatus: translation.fullTranslationStatus,
    startPagePreTranslation,
    startFullPreTranslation,
    startPageStreamingTranslation,
    // 全文翻译侧边栏状态
    showFullTranslationSidebar,
    // 活跃阅读时长同步（供 PdfViewer 调用）
    updateActiveReadingTime,
  }
})
