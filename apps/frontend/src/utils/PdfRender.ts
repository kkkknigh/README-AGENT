/**
 * PDF 渲染相关工具函数
 * 处理 Link Layer、Text Layer 的渲染
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { LinkOverlayRect, PageRef } from '../types/pdf'
import {
  appendInternalLinkOverlay,
  type DestinationCoords
} from './InternalLink'

function getTextDivRect(div: HTMLElement): LinkOverlayRect | null {
  const width = div.offsetWidth
  const height = div.offsetHeight

  if (width > 0 && height > 0) {
    return {
      left: div.offsetLeft,
      top: div.offsetTop,
      width,
      height
    }
  }

  const leftMatch = div.style.left.match(/(\d+\.?\d*)/)
  const topMatch = div.style.top.match(/(\d+\.?\d*)/)
  const widthMatch = div.style.width.match(/(\d+\.?\d*)/)
  const heightMatch = div.style.height.match(/(\d+\.?\d*)/)
  const fontMatch = div.style.fontSize.match(/(\d+\.?\d*)/)

  if (!leftMatch?.[1] || !topMatch?.[1]) return null

  const left = parseFloat(leftMatch[1])
  const top = parseFloat(topMatch[1])
  const fontSize = fontMatch?.[1] ? parseFloat(fontMatch[1]) : 0
  const fallbackWidth = (div.textContent?.length || 0) * (fontSize * 0.5)
  const fallbackHeight = fontSize
  const parsedWidth = widthMatch?.[1] ? parseFloat(widthMatch[1]) : 0
  const parsedHeight = heightMatch?.[1] ? parseFloat(heightMatch[1]) : 0

  return {
    left,
    top,
    width: parsedWidth || fallbackWidth,
    height: parsedHeight || fallbackHeight
  }
}

function calculateOverlapArea(a: LinkOverlayRect, b: LinkOverlayRect): number {
  const aRight = a.left + a.width
  const aBottom = a.top + a.height
  const bRight = b.left + b.width
  const bBottom = b.top + b.height

  const overlapLeft = Math.max(a.left, b.left)
  const overlapTop = Math.max(a.top, b.top)
  const overlapRight = Math.min(aRight, bRight)
  const overlapBottom = Math.min(aBottom, bBottom)

  if (overlapLeft < overlapRight && overlapTop < overlapBottom) {
    return (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
  }
  return 0
}

function normalizeSourceText(text: string | undefined): string | undefined {
  const result = text?.trim()
  if (!result) return undefined
  if (result.length > 50) {
    return result.slice(0, 50)
  }
  return result
}

function normalizeDestText(text: string): string {
  return text
    .replace(/[._-]+/g, ' ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function mergeSourceTexts(visibleText: string | undefined, directText: string | undefined): string | undefined {
  const normalizedVisible = normalizeSourceText(visibleText)
  const normalizedDirect = normalizeSourceText(directText)

  if (!normalizedVisible) return normalizedDirect
  if (!normalizedDirect) return normalizedVisible
  if (normalizedVisible.includes(normalizedDirect)) return normalizedVisible
  if (normalizedDirect.includes(normalizedVisible)) return normalizedDirect

  return normalizeSourceText(`${normalizedVisible} ${normalizedDirect}`)
}

export {
  fetchInternalLinkData,
  appendInternalLinkOverlay,
  getParagraphByCoords,
  type DestinationCoords,
  type InternalLinkResult
} from './InternalLink'

/**
 * 添加外部链接覆盖层
 */
export function appendLinkOverlay(
  container: HTMLElement,
  rect: LinkOverlayRect,
  href: string,
  title?: string
): void {
  const link = document.createElement('a')
  // 最终设置前移除 URL 内部空格，避免不可点击
  link.href = href.replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, '')
  link.target = '_blank'
  link.rel = 'noreferrer noopener'
  link.title = title || href
  link.style.display = 'block'
  link.style.left = `${rect.left}px`
  link.style.top = `${rect.top}px`
  link.style.width = `${rect.width}px`
  link.style.height = `${rect.height}px`
  link.style.position = 'absolute'
  link.className = 'hover:bg-yellow-200/20 cursor-pointer'
  container.appendChild(link)
}

/**
 * 渲染 Link Layer
 */
export async function renderLinkLayer(
  annotations: unknown[],
  viewport: { convertToViewportRectangle: (rect: number[]) => number[] },
  container: HTMLElement,
  pdfDoc: PDFDocumentProxy,
  onInternalLinkClick: (dest: DestinationCoords, clickX: number, clickY: number, sourceText?: string) => void,
  onDirectJump?: (dest: DestinationCoords) => void,
  textDivs?: HTMLElement[]
): Promise<void> {
  // 如果 linkLayer 已经有内容，说明已经渲染过，跳过重复渲染
  if (container.children.length > 0) {
    return
  }

  for (const annotation of annotations) {
    const annot = annotation as {
      subtype: string
      rect: number[]
      url?: string
      dest?: unknown
      action?: { dest?: unknown }
      title?: string
    }

    if (annot.subtype !== 'Link') continue

    // 计算注释在视口中的位置
    const rect = viewport.convertToViewportRectangle(annot.rect) as number[]
    if (rect.length < 4) continue
    const [x1, y1, x2, y2] = rect
    const overlayRect: LinkOverlayRect = {
      left: Math.min(x1!, x2!),
      top: Math.min(y1!, y2!),
      width: Math.abs(x2! - x1!),
      height: Math.abs(y2! - y1!)
    }

    // 从文本层提取与链接框相交的文字文本，作为精准的源引文。
    // 不再预处理，而是在点击时才进行匹配（延迟到 appendInternalLinkOverlay）

    const internalDest = annot.dest ?? annot.action?.dest

    if (annot.url) {
      // 外部链接
      appendLinkOverlay(container, overlayRect, annot.url, annot.url || 'External Link')
    } else if (internalDest) {
      // 带 action 的内部链接 - 延迟解析目标坐标和 sourceText 到点击时
      appendInternalLinkOverlay(
        container,
        overlayRect,
        internalDest,
        pdfDoc,
        (destCoords, cx, cy) => {
          // 点击时才提取 sourceText
          const sourceText = extractSourceText(internalDest, overlayRect, textDivs)
          onInternalLinkClick(destCoords, cx, cy, sourceText)
        },
        onDirectJump,
        '点击跳转到引用位置'
      )
    }
  }

  // 提取 sourceText 的辅助函数（点击时调用）
  function extractSourceText(
    dest: unknown,
    overlayRect: LinkOverlayRect,
    textDivs?: HTMLElement[]
  ): string | undefined {
    let destKeywords: string[] = []
    let directSourceText: string | undefined

    // 先从内部链接目标里提取可直接使用的文本，再与 textLayer 中的可见文本合并。
    if (typeof dest === 'string') {
      const trimmedDest = dest.trim()
      const lowerDest = trimmedDest.toLowerCase()

      // 匹配 cite.数字 模式（如 cite.5）
      const numMatch = lowerDest.match(/^cite\.(\d+)$/i)
      if (numMatch && numMatch[1]) {
        return `[${numMatch[1]}]`
      }

      // 匹配 cite.xxx 模式（如 cite.beyer2024paligemma）
      const citeMatch = trimmedDest.match(/^cite\.(.+)$/i)
      if (citeMatch && citeMatch[1]) {
        const citeBody = normalizeDestText(citeMatch[1].trim())
        directSourceText = citeBody
        // 按数字切分：beyer2024paligemma -> [beyer, 2024, paligemma]
        destKeywords = citeBody.toLowerCase().split(/\s+/).filter(Boolean)
      } else {
        directSourceText = normalizeDestText(trimmedDest)
      }
    }

    // 再从 textLayer 里找链接框附近真正显示出来的文本，并和上面的 directText 合并。
    if (textDivs && textDivs.length > 0) {
      let bestMatch: { text: string; score: number } | null = null

      for (const div of textDivs) {
        const textRect = getTextDivRect(div)
        if (!textRect || textRect.width <= 0 || textRect.height <= 0) continue

        const overlapArea = calculateOverlapArea(overlayRect, textRect)
        if (overlapArea <= 0) continue

        const textArea = textRect.width * textRect.height
        const overlapRatio = textArea > 0 ? overlapArea / textArea : 0

        // 计算匹配分数：重叠比例 + 关键词匹配
        let score = overlapRatio * 10 // 重叠比例基础分

        // 如果有 dest 关键词，检查文本中是否包含这些关键词
        if (destKeywords.length > 0) {
          const textLower = (div.textContent || '').toLowerCase()
          let keywordMatches = 0
          for (const keyword of destKeywords) {
            if (textLower.includes(keyword)) {
              keywordMatches++
            }
          }
          // 关键词匹配加分（每个关键词 +5 分）
          score += keywordMatches * 5
        }

        // 保留得分最高的文本
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { text: div.textContent || '', score }
        }
      }

      // 只有当得分超过阈值时才认为找到了足够可靠的可见文本。
      if (bestMatch && bestMatch.score > 5) {
        return mergeSourceTexts(bestMatch.text, directSourceText)
      }
    }

    return normalizeSourceText(directSourceText)
  }
}

/**
 * 修复 Text Layer 文字宽度对齐
 * 优化：分离读/写操作，避免强制同步布局
 */
export function fixTextLayerWidth(
  textContent: { items: unknown[] },
  textDivs: HTMLElement[],
  cssViewport: { scale: number }
): void {
  if (!textContent?.items || textDivs.length !== textContent.items.length) return

  const items = textContent.items as Array<{
    str?: string
    width?: number
    transform?: number[]
  }>

  // 第一阶段：批量读取所有需要的信息（只读，不修改样式）
  interface TextItemInfo {
    div: HTMLElement
    scaleFactor: number
    needsTransform: boolean
  }
  const transformsToApply: TextItemInfo[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const div = textDivs[i]

    if (!item?.str || !item?.width || !div) continue

    const targetWidth = item.width * cssViewport.scale
    
    // 使用 getBoundingClientRect 获取带小数的精确视觉尺寸
    // 因为此处只批量读取不写入，所以不会引起强制布局(Layout Thrashing)，性能同样好
    const rect = div.getBoundingClientRect()
    
    const transform = item.transform
    const isVertical = transform ? Math.abs(transform[0]!) < 1e-3 && Math.abs(transform[3]!) < 1e-3 : false
    const isHorizontal = !transform || (Math.abs(transform[1]!) < 1e-3 && Math.abs(transform[2]!) < 1e-3)

    let currentLength = 0
    if (isVertical) {
      currentLength = rect.height
    } else if (isHorizontal) {
      currentLength = rect.width
    } else {
      continue
    }

    if (currentLength > 0) {
      const deltaScale = targetWidth / currentLength
      if (Math.abs(deltaScale - 1) > 0.01) {
        transformsToApply.push({
          div,
          scaleFactor: deltaScale,
          needsTransform: true
        })
      }
    }
  }

  // 第二阶段：批量应用样式修改（只写，不读取）
  // 使用 requestAnimationFrame 确保在下一帧渲染前一次性应用
  if (transformsToApply.length > 0) {
    for (const { div, scaleFactor } of transformsToApply) {
      const existingTransform = div.style.transform || ''
      let oldScale = 1.0
      
      const match = existingTransform.match(/scaleX\(([^)]+)\)/)
      if (match && match[1]) {
        oldScale = parseFloat(match[1]) || 1.0
      }
      
      const cleanedTransform = existingTransform.replace(/scaleX\([^)]+\)/g, '').trim()
      const newScale = (oldScale * scaleFactor).toFixed(6)
      
      div.style.transform = cleanedTransform ? `${cleanedTransform} scaleX(${newScale})` : `scaleX(${newScale})`
    }
  }
}

/**
 * 应用过渡缩放效果
 */
export function applyInterimScaleToPage(
  refs: PageRef,
  _pageNumber: number,
  targetScale: number,
  lastRenderedScale: number | undefined,
  pageSize: { width: number; height: number }
): void {
  const renderedScale = lastRenderedScale ?? targetScale
  const ratio = renderedScale ? targetScale / renderedScale : 1

  const baseWidth = Math.floor(pageSize.width * renderedScale)
  const baseHeight = Math.floor(pageSize.height * renderedScale)
  const targetWidth = Math.floor(pageSize.width * targetScale)
  const targetHeight = Math.floor(pageSize.height * targetScale)

  // Canvas 直接用目标尺寸拉伸
  refs.canvas.style.width = `${targetWidth}px`
  refs.canvas.style.height = `${targetHeight}px`

  // 文本层保持"旧尺度"尺寸，通过 transform 过渡（仅当存在时）
  if (refs.textLayer) {
    refs.textLayer.style.width = `${baseWidth}px`
    refs.textLayer.style.height = `${baseHeight}px`
    refs.textLayer.style.top = '0'
    refs.textLayer.style.left = '0'
    refs.textLayer.style.transformOrigin = 'top left'
    refs.textLayer.style.transform = `scale(${ratio})`
  }

  // 链接层同样按旧尺寸 + 缩放（仅当存在时）
  if (refs.linkLayer) {
    refs.linkLayer.style.width = `${baseWidth}px`
    refs.linkLayer.style.height = `${baseHeight}px`
    refs.linkLayer.style.top = '0'
    refs.linkLayer.style.left = '0'
    refs.linkLayer.style.transformOrigin = 'top left'
    refs.linkLayer.style.transform = `scale(${ratio})`
  }

  // 高亮层同步缩放（仅当存在时）
  if (refs.highlightLayer) {
    refs.highlightLayer.style.width = `${baseWidth}px`
    refs.highlightLayer.style.height = `${baseHeight}px`
    refs.highlightLayer.style.top = '0'
    refs.highlightLayer.style.left = '0'
    refs.highlightLayer.style.transformOrigin = 'top left'
    refs.highlightLayer.style.transform = `scale(${ratio})`
  }
}
