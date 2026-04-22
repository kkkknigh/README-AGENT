/**
 * PDF 查看器相关类型定义
 */

import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

/** 每一页的元素定义 - 包含页面容器、Canvas 层、Text 层、Link 层和高亮层 */
export type PageRef = {
  /** 页面容器元素引用 */
  container: HTMLElement
  /** 页面绘制的画布引用（空白页面可能只有占位canvas） */
  canvas: HTMLCanvasElement
  /** 文字图层容器引用（空白页面为null） */
  textLayer: HTMLDivElement | null
  /** 链接图层容器引用（空白页面为null） */
  linkLayer: HTMLDivElement | null
  /** 高亮图层容器引用（空白页面为null） */
  highlightLayer: HTMLDivElement | null
}

/** 缩放锚点：包含页码、垂直/水平比例、以及目标回复的屏幕坐标（可选） */
export type ZoomAnchor = {
  page: number
  ratioY: number
  ratioX: number
  /** 鼠标缩放时的目标屏幕X */
  destX?: number
  /** 鼠标缩放时的目标屏幕Y */
  destY?: number
}

/** 链接覆盖层矩形定义 */
export type LinkOverlayRect = {
  left: number
  top: number
  width: number
  height: number
}

/** 页面尺寸 */
export type PageSize = {
  width: number
  height: number
}

/** 渲染选项 */
export type RenderPageOptions = {
  /** 是否保留已有内容 */
  preserveContent?: boolean
}

/** PDF 渲染状态 */
export type PdfRenderState = {
  pdfDoc: PDFDocumentProxy | null
  pageRefs: Map<number, PageRef>
  renderTasks: Map<number, RenderTask>
  renderedPages: Set<number>
  pagesNeedingRefresh: Set<number>
  lastRenderedScale: Map<number, number>
}

/** 选择信息 */
export type SelectionInfo = {
  page: number
  rects: Array<{
    left: number
    top: number
    width: number
    height: number
  }>
}

/** 高亮矩形 */
export type HighlightRect = {
  left: number
  top: number
  width: number
  height: number
}

/** 高亮项 */
export type HighlightItem = {
  id: string
  page: number
  rects: HighlightRect[]
  text: string
  color: string
}
