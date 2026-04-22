/**
 * PDF 内部链接处理相关工具函数
 * 包含内部链接解析、跳转目标解析、段落匹配等功能
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { LinkOverlayRect } from '../types/pdf'
import type { PdfParagraph } from '../types'
import { linkApi, type InternalLinkData } from '../api'

/**
 * 在 linkLayer 中搜索包含在段落区域内的链接
 * @param linkLayer - linkLayer DOM 元素
 * @param paragraph - 段落信息
 * @returns 找到的链接 URL，如果没有找到则返回 null
 */
function findLinkInParagraph(
  linkLayer: HTMLElement,
  paragraph: PdfParagraph,
  scale: number = 1
): string | null {
  // 获取 linkLayer 中所有的链接元素
  const links = linkLayer.querySelectorAll('a[href]')

  for (const link of Array.from(links)) {
    const htmlLink = link as HTMLAnchorElement
    const href = htmlLink.href

    // 获取链接元素的位置和尺寸
    const rect = htmlLink.getBoundingClientRect()
    const linkLayerRect = linkLayer.getBoundingClientRect()

    // 计算相对于 linkLayer 的坐标（考虑 CSS transform scale）
    // 直接从 computed style 读取 transform，更可靠
    const computedStyle = window.getComputedStyle(linkLayer)
    const transform = computedStyle.transform

    let cssScaleX = 1
    let cssScaleY = 1

    // 解析 transform matrix 获取缩放比例
    if (transform && transform !== 'none') {
      const matrixMatch = transform.match(/matrix\(([^)]+)\)/)
      if (matrixMatch && matrixMatch[1]) {
        const values = matrixMatch[1].split(',').map(v => parseFloat(v.trim()))
        if (values.length >= 6) {
          cssScaleX = values[0] || 1  // matrix(a, b, c, d, e, f) 中 a 是 scaleX
          cssScaleY = values[3] || 1  // d 是 scaleY
        }
      }
    }

    // 这些是相对于 linkLayer 元素自身的像素坐标 (at rendered scale)
    const relativeLeft = (rect.left - linkLayerRect.left) / cssScaleX
    const relativeTop = (rect.top - linkLayerRect.top) / cssScaleY
    const relativeRight = relativeLeft + rect.width / cssScaleX
    const relativeBottom = relativeTop + rect.height / cssScaleY

    // 转换为未缩放的 PDF 点坐标 (Unscaled Units)
    // paragraph.bbox 是未缩放的 (scale=1)
    const normalizedLeft = relativeLeft / scale
    const normalizedTop = relativeTop / scale
    const normalizedRight = relativeRight / scale
    const normalizedBottom = relativeBottom / scale

    // 检查链接是否在段落 bbox 内（添加 10px 容错范围）
    // paragraph.bbox: { x0, y0, x1, y1 } - CSS 坐标系，原点在左上角，y 向下
    if (!paragraph.bbox) {
      return null
    }
    
    const tolerance = 10
    const isInside =
      normalizedLeft >= paragraph.bbox.x0 - tolerance &&
      normalizedRight <= paragraph.bbox.x1 + tolerance &&
      normalizedTop >= paragraph.bbox.y0 - tolerance &&
      normalizedBottom <= paragraph.bbox.y1 + tolerance

    // console.log(`Checking link "${href}" (normalized) at [${normalizedLeft.toFixed(1)}, ${normalizedTop.toFixed(1)}, ${normalizedRight.toFixed(1)}, ${normalizedBottom.toFixed(1)}] against paragraph bbox [${paragraph.bbox.x0}, ${paragraph.bbox.y0}, ${paragraph.bbox.x1}, ${paragraph.bbox.y1}], scale=${scale}, isInside: ${isInside}`)
    console.log(`Checking link "${href}" (normalized) at [${normalizedLeft.toFixed(1)}, ${normalizedTop.toFixed(1)}, ${normalizedRight.toFixed(1)}, ${normalizedBottom.toFixed(1)}] against paragraph bbox [${paragraph.bbox.x0}, ${paragraph.bbox.y0}, ${paragraph.bbox.x1}, ${paragraph.bbox.y1}], scale=${scale}, isInside: ${isInside}`)

    if (isInside && href) {
      return href
    }
  }

  return null
}

/**
 * 生成 Google 搜索 URL
 * @param query - 搜索关键词
 * @returns Google 搜索 URL
 */
function generateGoogleSearchUrl(query: string): string {
  const encodedQuery = encodeURIComponent(query)
  return `https://www.google.com/search?q=${encodedQuery}`
}

/**
 * 内部链接数据返回类型（包含段落内容）
 */
export interface InternalLinkResult {
  linkData: InternalLinkData
  paragraphContent: string | null
}

/**
 * 获取内部链接数据
 * 根据目标坐标获取段落并向后端发送请求获取论文信息
 * 当 valid 为 0 时，会从 linkLayer 中搜索包含在段落内的链接
 */
export async function fetchInternalLinkData(
  pdfId: string,
  destCoords: { page: number; x: number | null; y: number | null },
  paragraphs: PdfParagraph[],
  getLinkLayer?: (page: number) => HTMLElement | null,
  pdfDoc?: PDFDocumentProxy,
  sourceText?: string
): Promise<InternalLinkResult | null> {
  const targetParagraph = getParagraphByCoords(destCoords.page, destCoords.x, destCoords.y, paragraphs, sourceText)
  if (!targetParagraph) {
    return null
  }

  try {
    console.log(`Fetching internal link data for pdf ${pdfId}, paragraph ${targetParagraph.id}`)
    const data = await linkApi.getLinkData(pdfId, targetParagraph.id)
    console.log('Link data received:', data)

    // 如果 valid 不为 1，表示内容有缺失，需要从 linkLayer 搜索
    if (data.valid !== 1) {
      console.log('internal link data invalid (valid != 1), fallback to search in linkLayer')
      // 获取目标页的 linkLayer
      const linkLayer = getLinkLayer?.(destCoords.page)

      if (linkLayer) {
        console.log('LinkLayer found for page', destCoords.page)
        // 计算缩放比例
        let scale = 1
        if (pdfDoc) {
          try {
            const page = await pdfDoc.getPage(destCoords.page)
            const viewport = page.getViewport({ scale: 1 })
            if (viewport.width > 0 && linkLayer.offsetWidth > 0) {
              scale = linkLayer.offsetWidth / viewport.width
            }
          } catch (e) {
            console.warn('Failed to calculate scale for findLinkInParagraph:', e)
          }
        }

        // 在 linkLayer 中搜索包含在段落内的链接
        const foundUrl = findLinkInParagraph(linkLayer, targetParagraph, scale)
        console.log('Search result in linkLayer:', foundUrl)

        if (foundUrl) {
          // 找到链接，使用这个链接
          return {
            linkData: {
              ...data,
              url: foundUrl
            },
            paragraphContent: targetParagraph.content
          }
        }
      } else {
        console.warn('LinkLayer NOT found for page', destCoords.page)
      }

      // 没有找到链接，生成 Google 搜索 URL
      // 使用段落内容作为搜索关键词
      const searchQuery = targetParagraph.content.trim().slice(0, 100) // 限制长度
      const googleUrl = generateGoogleSearchUrl(searchQuery)

      return {
        linkData: {
          ...data,
          url: googleUrl
        },
        paragraphContent: targetParagraph.content
      }
    }

    return {
      linkData: data,
      paragraphContent: null
    }
  } catch (err) {
    console.error('Failed to fetch internal link data:', err)
    return null
  }
}

/**
 * 检查目标是否为直接跳转类型
 * 以 "cite:" 开头的按论文引用处理（弹窗），其他一律直接跳转
 */
function isDirectJumpDestination(dest: unknown): boolean {
  if (typeof dest === 'string') {
    const lowerDest = dest.toLowerCase()
    // 以 cite: 开头的按论文处理（不直接跳转）
    return !lowerDest.startsWith('cite.')
  }
  // 非字符串类型的目标也直接跳转
  return true
}

/**
 * 添加内部链接覆盖层
 * 点击时才解析目标坐标（延迟解析以优化性能）
 * 对于 table, section, figure, appendix 开头的链接直接跳转
 */
export function appendInternalLinkOverlay(
  container: HTMLElement,
  rect: LinkOverlayRect,
  rawDest: unknown,
  pdfDoc: PDFDocumentProxy,
  onClick: (destCoords: DestinationCoords, clickX: number, clickY: number) => void,
  onDirectJump?: (destCoords: DestinationCoords) => void,
  title?: string
): void {
  const link = document.createElement('div')
  link.title = title || '内部链接'
  link.style.display = 'block'
  link.style.left = `${rect.left}px`
  link.style.top = `${rect.top}px`
  link.style.width = `${rect.width}px`
  link.style.height = `${rect.height}px`
  link.style.position = 'absolute'
  link.className = 'hover:bg-blue-200/30 cursor-pointer internal-link'

  // 判断是否为直接跳转类型
  const isDirectJump = isDirectJumpDestination(rawDest)

  // 防止与容器的点击处理冲突
  link.addEventListener('mousedown', (e) => {
    e.stopPropagation()
  })

  link.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    // 点击时才解析目标坐标
    const destCoords = await resolveDestination(pdfDoc, rawDest)
    if (destCoords) {
      if (isDirectJump && onDirectJump) {
        // 直接跳转到目标位置
        onDirectJump(destCoords)
      } else {
        // 显示弹窗
        onClick(destCoords, e.clientX, e.clientY)
      }
    }
  })
  container.appendChild(link)
}

/**
 * PDF 内部链接目标坐标
 * XYZ 目标类型: [pageRef, 'XYZ', x, y, zoom]
 * Fit 目标类型: [pageRef, 'Fit']
 * FitH 目标类型: [pageRef, 'FitH', top]
 */
export type DestinationCoords = {
  /** 目标页码 */
  page: number
  /** X 坐标 (PDF 用户空间单位) */
  x: number | null
  /** Y 坐标 (PDF 用户空间单位) */
  y: number | null
  /** 缩放级别 (null 表示保持当前缩放) */
  zoom: number | null
  /** 目标类型: XYZ, Fit, FitH, FitV, FitR, FitB, FitBH, FitBV */
  type: string
}

/**
 * 根据页码和坐标获取对应的自然段
 * 注意：传入的坐标是 PDF 坐标系（原点在左下角，Y 轴向上）
 * 但 paragraph.bbox 存储的是 CSS 坐标系（原点在左上角，Y 轴向下）
 * @param page - 页码（1-based）
 * @param x - X 坐标（PDF 用户空间单位，从左向右）
 * @param y - Y 坐标（PDF 用户空间单位，从下向上）
 * @param paragraphs - 段落数组
 * @param pageHeight - 页面高度（PDF 单位），用于坐标转换，必须提供
 * @returns 匹配的 PdfParagraph 或 null
 */
export function getParagraphByCoords(
  page: number,
  x: number | null,
  y: number | null,
  paragraphs: PdfParagraph[],
  sourceText?: string
): PdfParagraph | null {
  if (!paragraphs || paragraphs.length === 0) {
    console.warn(`No paragraphs available for page ${page}`)
    return null
  }
  if (x === null && y === null) {
    console.warn(`Invalid coordinates for getParagraphByCoords: x=${x}, y=${y}`)
    return null
  }

  // 筛选出目标页面的段落
  const pageParagraphs = paragraphs.filter(p => p.page === page)
  if (pageParagraphs.length === 0) {
    console.warn(`No paragraphs found on page ${page}`)
    return null
  }

  // 极端情况
  if (y === null) {
    let closestParagraph: PdfParagraph | null = null
    let minScore = Infinity
    for (const paragraph of pageParagraphs) {
      if (x !== null && paragraph.bbox) {
        const dx = Math.abs(paragraph.bbox.x0 - x)
        if (dx < minScore) {
          minScore = dx
          closestParagraph = paragraph
        }
      }
    }
    return closestParagraph
  }

  // 1. 根据 y0距离 + 没有出界 筛选第一轮候选池
  let candidates: PdfParagraph[] = []

  for (const p of pageParagraphs) {
    if (!p.bbox) continue
    const { y0, y1 } = p.bbox
    if ((y >= y0 - 5 && y <= y1 + 5) || Math.abs(y0 - y) < 10) {
      candidates.push(p)
    }
  }

  // 兜底
  if (candidates.length === 0) {
    const sorted = [...pageParagraphs].filter(p => p.bbox).sort((a, b) => Math.abs(a.bbox!.y0 - y) - Math.abs(b.bbox!.y0 - y))
    if (sorted.length > 0) {
      const minDy = Math.abs(sorted[0]!.bbox!.y0 - y)
      candidates = sorted.filter(p => Math.abs(Math.abs(p.bbox!.y0 - y) - minDy) <= 5)
    }
  }

  // 2. 候选中匹配文字 
  if (sourceText && candidates.length > 1) {
    // 识别引用标记模式，例如 [1], [12, 13], (Smith, 2020)
    const citationRegex = /(\[\d+(?:,\s*\d+)*\]|\([\w\s]+,\s*\d{4}\))/g
    const citations = sourceText.match(citationRegex) || []
    const citationSet = new Set(citations.map(item => item.toLowerCase()))

    // 按照指定规则过滤、切割正文中的特殊符号，但保留中括号内的内容（作为整体或单独键）
    // 先把引用标记提取出来，剩下的再按常规分隔符切分
    let remainingText = sourceText
    for (const c of citations) {
      remainingText = remainingText.replace(c, ' ')
    }

    const regularKeys = remainingText.split(/[\s,.;:\[\]()\-]+/).filter(k => k.length > 2)
    const keys = [...citations, ...regularKeys]

    if (keys.length > 0) {
      let maxScore = -1
      let bestMatchPara = candidates[0]!

      for (const p of candidates) {
        const content = p.content?.toLowerCase() || ''
        let score = 0
        // 在该段落中一个一个匹配切割出来的单词/引用标记，并且忽略大小写
        for (const k of keys) {
          const lowerK = k.toLowerCase()
          if (content.includes(lowerK)) {
            if (citationSet.has(lowerK)) {
              score += 5
            } else {
              score += 1
            }
          }
        }
        if (score > maxScore) {
          maxScore = score
          bestMatchPara = p
        }
      }

      // 只要有一点命中的，立刻通过文本匹配宣告胜利
      if (maxScore > 0) {
        return bestMatchPara
      }
    }
  }

  let bestPara = candidates[0]!
  let minDiff = Infinity
  for (const p of candidates) {
    const { y0, y1 } = p.bbox
    let score = Math.abs(y0 - y)

    // 段内包围奖励
    if (y >= y0 && y <= y1) {
      score -= 10
    }

    if (score < minDiff) {
      minDiff = score
      bestPara = p
    }
  }

  return bestPara
}

/**
 * 解析 PDF 内部链接目标页码和坐标
 */
export async function resolveDestination(
  pdfDoc: PDFDocumentProxy,
  dest: unknown
): Promise<DestinationCoords | null> {
  if (!pdfDoc) return null

  try {
    let destArray = dest
    console.log('Resolving destination:', dest)

    // 如果目标是 String，需要先解析
    if (typeof dest === 'string') {
      destArray = await pdfDoc.getDestination(dest)
    }

    // 确保目标是数组
    if (!destArray || !Array.isArray(destArray)) return null

    // 目标数组的第一个元素是页面引用
    const pageRef = destArray[0]
    if (!pageRef) return null

    // 获取页码
    const pageIndex = await pdfDoc.getPageIndex(pageRef)
    const pageNumber = pageIndex + 1 // 页码从 1 开始

    // 获取页面尺寸（直接从 PDF 文档获取，不依赖 store）
    const page = await pdfDoc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const pageHeight = viewport.height

    // 解析目标类型和坐标
    // destArray[1] 可能是字符串或 {name: string} 对象
    const destTypeRaw = destArray[1]
    const destType = typeof destTypeRaw === 'string'
      ? destTypeRaw
      : (destTypeRaw as { name?: string })?.name || 'Fit'

    let x: number | null = null
    let y: number | null = null
    let zoom: number | null = null

    switch (destType) {
      case 'XYZ':
        // [pageRef, 'XYZ', x, y, zoom]
        x = typeof destArray[2] === 'number' ? destArray[2] : null
        y = typeof destArray[3] === 'number' ? destArray[3] : null
        zoom = typeof destArray[4] === 'number' ? destArray[4] : null
        break
      case 'FitH':
      case 'FitBH':
        // [pageRef, 'FitH', top]
        y = typeof destArray[2] === 'number' ? destArray[2] : null
        break
      case 'FitV':
      case 'FitBV':
        // [pageRef, 'FitV', left]
        x = typeof destArray[2] === 'number' ? destArray[2] : null
        break
      case 'FitR':
        // [pageRef, 'FitR', left, bottom, right, top]
        x = typeof destArray[2] === 'number' ? destArray[2] : null
        y = typeof destArray[5] === 'number' ? destArray[5] : null
        break
      case 'Fit':
      case 'FitB':
      default:
        // 无特定坐标，适应页面
        console.warn(`Unsupported destination type "${destType}", defaulting to "Fit"`)
        break
    }

    return {
      page: pageNumber,
      x,
      y: y !== null ? pageHeight - y : null,
      zoom,
      type: destType || 'Fit'
    }

  } catch (err) {
    console.error('Error resolving destination:', err)
    return null
  }
}
