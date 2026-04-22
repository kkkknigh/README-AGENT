/**
 * PDF 页面渲染 Composable
 * 处理页面渲染、可见区域检测、Link Layer 渲染
 * 优化：只渲染"翻阅过的页面±1页"与"当前页面±10页"交叉的部分
 */

import { nextTick, ref, computed } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { renderTextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import type { Ref } from 'vue'
import type { PageRef, RenderPageOptions, PageSize } from '../types/pdf'
import { getPageAtY, getScaledPageSize, getPageSize, getPageTop } from '../utils/PdfHelper'
import { renderLinkLayer, fixTextLayerWidth, applyInterimScaleToPage } from '../utils/PdfRender'

export interface UsePageRenderOptions {
  buffer?: number
  onPageRendered?: (pageNumber: number) => void
}

/** 当前页面前后渲染范围 */
const CURRENT_PAGE_RANGE = 10
/** 已访问页面前后渲染范围 */
const VISITED_PAGE_RANGE = 1

/**
 * 使用 requestIdleCallback 延迟执行非关键任务
 */
function runWhenIdle<T>(fn: () => T | Promise<T>, timeout = 100): Promise<T> {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      try {
        const result = await fn()
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }

    if ('requestIdleCallback' in window) {
      requestIdleCallback(execute, { timeout })
    } else {
      setTimeout(execute, 0)
    }
  })
}

export function usePageRender(
  containerRef: Ref<HTMLElement | null>,
  pdfDoc: Ref<PDFDocumentProxy | null>,
  pageNumbers: Ref<number[]>,
  pageRefs: Map<number, PageRef>,
  renderTasks: Map<number, RenderTask>,
  renderedPages: Ref<Set<number>>,
  pagesNeedingRefresh: Set<number>,
  lastRenderedScale: Map<number, number>,
  pageSizesConstant: Ref<PageSize | null>,
  pageSizesArray: Ref<PageSize[] | null>,
  pageHeightAccumulator: Ref<number[]>,
  scale: Ref<number>,
  isZooming: Ref<boolean>,
  composableOptions: UsePageRenderOptions = {}
) {
  const { buffer = window.innerHeight * 0.5 } = composableOptions
  const visiblePages = ref<Set<number>>(new Set<number>())
  const maxOutputScale = 2

  // 记录用户翻阅过的页面
  const visitedPages = ref<Set<number>>(new Set<number>())
  // 当前页面（用于计算渲染范围）
  const currentPageForRender = ref<number>(1)

  /**
   * 判断页面是否应该渲染完整内容（canvas, textLayer, linkLayer）
   * 条件：页面同时在"当前页面±10页"范围内 且 在"已访问页面±1页"范围内
   */
  const shouldRenderPageContent = computed(() => {
    return (pageNumber: number): boolean => {
      const current = currentPageForRender.value
      
      // 检查是否在"当前页面±10页"范围内
      const inCurrentRange = pageNumber >= current - CURRENT_PAGE_RANGE && 
                            pageNumber <= current + CURRENT_PAGE_RANGE

      // 检查是否在"已访问页面±1页"范围内
      let inVisitedRange = false
      for (const visitedPage of visitedPages.value) {
        if (pageNumber >= visitedPage - VISITED_PAGE_RANGE && 
            pageNumber <= visitedPage + VISITED_PAGE_RANGE) {
          inVisitedRange = true
          break
        }
      }

      return inCurrentRange && inVisitedRange
    }
  })

  function hasLiveCanvasContent(pageNumber: number): boolean {
    const refs = pageRefs.get(pageNumber)
    if (!refs) return false

    const liveCanvas = refs.container.querySelector('canvas')
    if (!(liveCanvas instanceof HTMLCanvasElement)) return false

    // 新挂载 canvas 默认有 300x150，不能用尺寸判断是否真正渲染完成。
    return liveCanvas.dataset.rendered === '1'
  }

  /**
   * 核心渲染逻辑：仅渲染可见区域页面，并更新已访问页面记录
   */
  const updateVisiblePages = useDebounceFn(() => {
    if (!containerRef.value || !pdfDoc.value) return

    const container = containerRef.value
    const scrollTop = container.scrollTop
    const clientHeight = container.clientHeight

    const startY = Math.max(0, scrollTop - buffer)
    const endY = scrollTop + clientHeight + buffer

    const startPage = getPageAtY(
      startY,
      pageNumbers.value.length,
      scale.value,
      pageSizesConstant.value,
      pageSizesArray.value,
      pageHeightAccumulator.value
    )
    const endPage = getPageAtY(
      endY,
      pageNumbers.value.length,
      scale.value,
      pageSizesConstant.value,
      pageSizesArray.value,
      pageHeightAccumulator.value
    )

    const newVisiblePages = new Set<number>()
    
    // 找到最接近视口中心的页面作为当前页面
    let nearestPage = startPage
    let minDistance = Infinity
    const viewportCenter = scrollTop + clientHeight / 2
    
    for (let p = startPage; p <= endPage; p++) {
      if (p > pageNumbers.value.length) break
      newVisiblePages.add(p)
      
      // 记录到已访问页面集合
      visitedPages.value.add(p)
      
      // 计算该页面中心与视口中心的距离
      const pageTop = getPageTop(p, scale.value, pageSizesConstant.value, pageSizesArray.value, pageHeightAccumulator.value)
      const pageSize = getScaledPageSize(p, scale.value, pageSizesConstant.value, pageSizesArray.value)
      const pageCenter = pageTop + pageSize.height / 2
      const distance = Math.abs(pageCenter - viewportCenter)
      
      if (distance < minDistance) {
        minDistance = distance
        nearestPage = p
      }
    }
    
    // 更新当前页面（用于计算渲染范围）
    currentPageForRender.value = nearestPage

    // 只渲染应该渲染完整内容的页面
    const pagesToRender: Array<{ page: number; preserveContent: boolean }> = []
    for (let p = startPage; p <= endPage; p++) {
      if (p > pageNumbers.value.length) break
      
      // 只有需要渲染完整内容的页面才进行实际渲染
      if (!shouldRenderPageContent.value(p)) continue

      const alreadyRendered = renderedPages.value.has(p)
      const needsRefresh = pagesNeedingRefresh.has(p)
      const missingLiveCanvas = !hasLiveCanvasContent(p)
      const shouldRenderNow = !alreadyRendered || missingLiveCanvas || (!isZooming.value && needsRefresh)

      if (shouldRenderNow && !renderTasks.has(p)) {
        pagesToRender.push({ page: p, preserveContent: alreadyRendered })
        pagesNeedingRefresh.delete(p)
      }
    }

    visiblePages.value = newVisiblePages

    // 等待 shouldRenderPageContent 驱动的 DOM 更新完成后再触发渲染
    if (pagesToRender.length > 0) {
      void nextTick().then(() => {
        for (const item of pagesToRender) {
          if (!renderTasks.has(item.page)) {
            void renderPage(item.page, { preserveContent: item.preserveContent })
          }
        }
      })
    }
  }, 150)

  /**
   * 渲染单个页面
   */
  async function renderPage(pageNumber: number, options?: RenderPageOptions): Promise<void> {
    const pdf = pdfDoc.value
    const refs = pageRefs.get(pageNumber)
    if (!pdf || !refs) {
      if (!pdf) console.warn(`Cannot render page ${pageNumber}: PDF document not loaded`)
      if (!refs) console.warn(`Cannot render page ${pageNumber}: page refs not found`)
      return
    }

    if (renderTasks.has(pageNumber)) {
      console.warn(`Render task already in progress for page ${pageNumber}`)
      return
    }

    const preserveContent = !!options?.preserveContent && renderedPages.value.has(pageNumber)

    // 虚拟渲染会切换占位层与真实层，渲染前同步到当前在线 DOM 引用
    const syncLiveLayerRefs = async (): Promise<boolean> => {
      let liveCanvas = refs.container.querySelector('canvas')
      if (!(liveCanvas instanceof HTMLCanvasElement)) {
        await nextTick()
        liveCanvas = refs.container.querySelector('canvas')
      }

      if (!(liveCanvas instanceof HTMLCanvasElement)) {
        return false
      }

      refs.canvas = liveCanvas
      const liveTextLayer = refs.container.querySelector('.textLayer')
      const liveLinkLayer = refs.container.querySelector('.linkLayer')
      const liveHighlightLayer = refs.container.querySelector('.highlightLayer')

      refs.textLayer = liveTextLayer instanceof HTMLDivElement ? liveTextLayer : null
      refs.linkLayer = liveLinkLayer instanceof HTMLDivElement ? liveLinkLayer : null
      refs.highlightLayer = liveHighlightLayer instanceof HTMLDivElement ? liveHighlightLayer : null

      return true
    }

    const hasLiveRefs = await syncLiveLayerRefs()
    if (!hasLiveRefs) {
      console.warn(`Cannot render page ${pageNumber}: live canvas not found`)
      return
    }

    // 记录渲染开始时的 scale，用于后续检查 scale 是否已变化
    const renderStartScale = scale.value

    // 如果 scale 已经改变，取消渲染（除非是 preserveContent 模式下的更新需要）
    if (!preserveContent && lastRenderedScale.get(pageNumber) === renderStartScale) {
      // 如果已经渲染过且比例相同，且不需要刷新，可能不需要重复操作
      // 但通常这类逻辑在 updateVisiblePages 处理
    }

    const page = await pdf.getPage(pageNumber)

    const targetCanvas = preserveContent
      ? document.createElement('canvas')
      : refs.canvas

    // 标记为待渲染，避免空白 canvas 被误判成已渲染页面。
    refs.canvas.dataset.rendered = '0'

    const context = targetCanvas.getContext('2d', {
      alpha: false
    })
    if (!context) {
      console.warn(`Failed to get 2D context for page ${pageNumber} canvas`)
      return
    }

    const outputScale = Math.min(window.devicePixelRatio || 1, maxOutputScale)
    const cssViewport = page.getViewport({ scale: scale.value })
    const renderViewport = page.getViewport({ scale: scale.value * outputScale })

    const scaledSize = getScaledPageSize(
      pageNumber,
      scale.value,
      pageSizesConstant.value,
      pageSizesArray.value
    )
    const displayWidth = scaledSize.width
    const displayHeight = scaledSize.height

    refs.container.style.width = `${displayWidth}px`
    refs.container.style.height = `${displayHeight}px`

    targetCanvas.width = Math.floor(renderViewport.width)
    targetCanvas.height = Math.floor(renderViewport.height)
    targetCanvas.style.width = `${displayWidth}px`
    targetCanvas.style.height = `${displayHeight}px`

    if (refs.textLayer) {
      refs.textLayer.style.width = `${displayWidth}px`
      refs.textLayer.style.height = `${displayHeight}px`
      refs.textLayer.style.setProperty('--scale-factor', `${cssViewport.scale}`)
      refs.textLayer.style.transform = 'scale(1)'
      refs.textLayer.style.transformOrigin = 'top left'
      refs.textLayer.innerHTML = ''
    }

    if (refs.linkLayer) {
      refs.linkLayer.style.width = `${displayWidth}px`
      refs.linkLayer.style.height = `${displayHeight}px`
      refs.linkLayer.style.transform = 'scale(1)'
      refs.linkLayer.style.transformOrigin = 'top left'
      refs.linkLayer.innerHTML = ''
    }

    if (refs.highlightLayer) {
      refs.highlightLayer.style.width = `${displayWidth}px`
      refs.highlightLayer.style.height = `${displayHeight}px`
      refs.highlightLayer.style.transform = 'scale(1)'
      refs.highlightLayer.style.transformOrigin = 'top left'
    }

    const renderTask = page.render({
      canvasContext: context,
      viewport: renderViewport
    })
    renderTasks.set(pageNumber, renderTask)

    try {
      await renderTask.promise
      
      // 获取文本内容
      const textContent = await page.getTextContent()
      const textDivs: HTMLElement[] = []
      
      // 判断是否为可见页面（视口内页面使用完整渲染，非可见页面使用延迟渲染）
      const container = containerRef.value
      const isVisiblePage = container ? (() => {
        const scrollTop = container.scrollTop
        const clientHeight = container.clientHeight
        const pageTop = refs.container.offsetTop
        const pageBottom = pageTop + displayHeight
        return pageBottom >= scrollTop && pageTop <= scrollTop + clientHeight
      })() : false
      
      if (refs.textLayer) {
        if (isVisiblePage) {
          // 可见页面：正常渲染文本层
          await renderTextLayer({
            textContentSource: textContent as TextContent,
            container: refs.textLayer as HTMLElement,
            viewport: cssViewport,
            textDivs
          }).promise
        } else {
          // 非可见页面（预加载）：延迟渲染文本层，优先保证主线程响应
          await runWhenIdle(() => 
            renderTextLayer({
              textContentSource: textContent as TextContent,
              container: refs.textLayer as HTMLElement,
              viewport: cssViewport,
              textDivs
            }).promise,
            200
          )
        }
      }

      fixTextLayerWidth(textContent, textDivs, cssViewport)

      // Link Layer 渲染也使用延迟执行（仅当 linkLayer 存在时）
      if (refs.linkLayer) {
        try {
          const annotations = await page.getAnnotations()
          
          // 使用 runWhenIdle 延迟非关键的 link layer 渲染
          await runWhenIdle(() => 
            renderLinkLayer(
              annotations,
              cssViewport,
              refs.linkLayer!,
              pdf,
              (destCoords, clickX, clickY, sourceText) => {
                const event = new CustomEvent('pdf-internal-link', {
                  detail: { destCoords, clickX, clickY, sourceText }
                })
                window.dispatchEvent(event)
              },
              (destCoords) => {
                scrollToPage(destCoords.page, true)
              },
              textDivs
            ),
            isVisiblePage ? 50 : 300
          )
        } catch (err) {
          console.error('Error rendering Link Layer:', err)
        }
      }

      // 检查 scale 是否在渲染过程中已变化，如果变化则跳过样式更新
      // 避免过时的渲染结果覆盖当前正确的 canvas 尺寸
      if (scale.value !== renderStartScale) {
        return
      }

      if (preserveContent) {
        const destContext = refs.canvas.getContext('2d', { alpha: false })
        if (destContext) {
          refs.canvas.width = targetCanvas.width
          refs.canvas.height = targetCanvas.height
          refs.canvas.style.width = targetCanvas.style.width
          refs.canvas.style.height = targetCanvas.style.height
          destContext.clearRect(0, 0, refs.canvas.width, refs.canvas.height)
          destContext.drawImage(targetCanvas, 0, 0)
        }
      }

      refs.canvas.dataset.rendered = '1'

      lastRenderedScale.set(pageNumber, scale.value)
      renderedPages.value = new Set([...renderedPages.value, pageNumber])

      if (composableOptions?.onPageRendered) {
        composableOptions.onPageRendered(pageNumber)
      }
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error(err)
      }
    } finally {
      renderTasks.delete(pageNumber)
    }
  }

  /**
   * 应用过渡缩放效果（仅处理可视区域附近的页面，其余只更新容器尺寸）
   * 优化：只对可视区域 ±2 页的页面应用完整的 transform 缩放，减少 DOM 操作开销
   */
  function applyInterimScale(): void {
    const container = containerRef.value
    const targetScale = scale.value

    // 计算可视范围页码
    let startPage = 1
    let endPage = pageNumbers.value.length
    if (container) {
      const scrollTop = container.scrollTop
      const clientHeight = container.clientHeight
      const startY = Math.max(0, scrollTop - buffer)
      const endY = scrollTop + clientHeight + buffer

      startPage = getPageAtY(startY, pageNumbers.value.length, targetScale, pageSizesConstant.value, pageSizesArray.value, pageHeightAccumulator.value)
      endPage = getPageAtY(endY, pageNumbers.value.length, targetScale, pageSizesConstant.value, pageSizesArray.value, pageHeightAccumulator.value)
    }

    // 只对可视区域 ±2 页的页面进行完整的 interim scale 处理
    // 其他页面只更新容器尺寸，大幅减少了 transform 计算和 DOM 操作
    const INTERIM_SCALE_BUFFER_PAGES = 2
    const criticalStartPage = Math.max(1, startPage - INTERIM_SCALE_BUFFER_PAGES)
    const criticalEndPage = Math.min(pageNumbers.value.length, endPage + INTERIM_SCALE_BUFFER_PAGES)

    pageRefs.forEach((refs, pageNumber) => {
      const size = getPageSize(pageNumber, pageSizesConstant.value, pageSizesArray.value)
      if (!size) return

      // 所有页面都需要更新容器尺寸（保证滚动高度正确）
      const targetWidth = Math.floor(size.width * targetScale)
      const targetHeight = Math.floor(size.height * targetScale)
      refs.container.style.width = `${targetWidth}px`
      refs.container.style.height = `${targetHeight}px`

      // 仅临界区域内的页面做完整的 interim scale（canvas + 文本层等）
      // 减少 DOM transform 操作数量，提升缩放流畅度
      if (pageNumber >= criticalStartPage && pageNumber <= criticalEndPage) {
        applyInterimScaleToPage(refs, pageNumber, targetScale, lastRenderedScale.get(pageNumber), size)
      } else {
        // 临界区域外的页面：仅重置 canvas 尺寸，不应用 transform 缩放
        // 这些页面会在缩放结束后重新渲染
        const renderedScale = lastRenderedScale.get(pageNumber)
        if (renderedScale) {
          // 使用 CSS 缩放代替 transform，性能更好
          refs.canvas.style.width = `${targetWidth}px`
          refs.canvas.style.height = `${targetHeight}px`
          // 清除其他层的 transform，避免残留效果（仅当元素存在时）
          if (refs.textLayer) refs.textLayer.style.transform = 'none'
          if (refs.linkLayer) refs.linkLayer.style.transform = 'none'
          if (refs.highlightLayer) refs.highlightLayer.style.transform = 'none'
        }
      }
    })
  }

  /**
   * 滚动到指定页面
   */
  async function scrollToPage(page: number, instant: boolean = false): Promise<void> {
    if (!containerRef.value) return

    // 确保页码合法
    const total = pageNumbers.value.length
    if (page < 1 || (total > 0 && page > total)) return

    const behavior = instant ? 'instant' : 'smooth'

    // 尝试直接滚动
    const refs = pageRefs.get(page)
    if (refs && refs.container) {
      containerRef.value.scrollTo({
        top: Math.round(refs.container.offsetTop - 12),
        behavior: behavior as ScrollBehavior
      })
      return
    }

    // 如果 refs 不存在，可能是正在加载中，尝试等待 DOM 更新
    await nextTick()

    const maxRetries = 5
    for (let i = 0; i < maxRetries; i++) {
      const retryRefs = pageRefs.get(page)
      if (retryRefs && retryRefs.container && containerRef.value) {
        containerRef.value.scrollTo({
          top: Math.round(retryRefs.container.offsetTop - 12),
          behavior: behavior as ScrollBehavior
        })
        return
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  /**
   * 设置当前页面（用于计算渲染范围）
   */
  function setCurrentPageForRender(page: number) {
    currentPageForRender.value = page
  }

  /**
   * 清除已访问页面记录（切换PDF时调用）
   */
  function clearVisitedPages() {
    visitedPages.value.clear()
    currentPageForRender.value = 1
  }

  return {
    visiblePages,
    updateVisiblePages,
    renderPage,
    applyInterimScale,
    scrollToPage,
    shouldRenderPageContent,
    setCurrentPageForRender,
    clearVisitedPages
  }
}
