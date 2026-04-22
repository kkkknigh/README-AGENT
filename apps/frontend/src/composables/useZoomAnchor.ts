/**
 * 缩放锚点管理 Composable
 * 处理缩放时的位置捕获和恢复
 */

import { ref, type Ref } from 'vue'
import { nextTick } from 'vue'
import type { ZoomAnchor, PageRef } from '../types/pdf'
import { getPageTop, getScaledPageSize, getPageAtY } from '../utils/PdfHelper'
import type { PageSize } from '../types/pdf'

export function useZoomAnchor(
  containerRef: Ref<HTMLElement | null>,
  pageNumbers: Ref<number[]>,
  pageRefs: Map<number, PageRef>,
  pageSizesConstant: Ref<PageSize | null>,
  pageSizesArray: Ref<PageSize[] | null>,
  pageHeightAccumulator: Ref<number[]>,
  scale: Ref<number>
) {
  const pendingAnchor = ref<ZoomAnchor | null>(null)

  /**
   * 捕获当前的中心锚点，用于缩放后恢复位置
   * @param mousePos - 可选的鼠标位置（相对于视口坐标）
   */
  function captureCenterAnchor(mousePos?: { x: number; y: number }): ZoomAnchor | null {
    const container = containerRef.value
    if (!container || !pageNumbers.value.length) return null

    const rect = container.getBoundingClientRect()

    const targetX = mousePos
      ? (mousePos.x - rect.left + container.scrollLeft)
      : (container.scrollLeft + container.clientWidth / 2)

    const targetY = mousePos
      ? (mousePos.y - rect.top + container.scrollTop)
      : (container.scrollTop + container.clientHeight / 2)

    let anchor: ZoomAnchor | null = null

    // 使用计算/二分法快速定位页面
    const page = getPageAtY(
      targetY,
      pageNumbers.value.length,
      scale.value,
      pageSizesConstant.value,
      pageSizesArray.value,
      pageHeightAccumulator.value
    )

    if (page) {
      const refs = pageRefs.get(page)
      const size = getScaledPageSize(
        page,
        scale.value,
        pageSizesConstant.value,
        null
      )

      if (refs) {
        // 使用纯计算获取页面位置和尺寸，确保与 restoreAnchor 完全一致
        // 避免使用 offsetTop/offsetLeft/offsetHeight/offsetWidth，因为它们可能包含
        // 容器的 padding/margin，导致与 restoreAnchor 中的纯计算不一致
        const pageTop = getPageTop(
          page,
          scale.value,
          pageSizesConstant.value,
          pageSizesArray.value,
          pageHeightAccumulator.value
        )
        // 水平居中计算：与 restoreAnchor 中的逻辑一致
        const pageLeft = size.width <= container.clientWidth
          ? Math.round((container.clientWidth - size.width) / 2)
          : 0
        const height = size.height
        const width = size.width

        anchor = {
          page,
          ratioY: (targetY - pageTop) / height,
          ratioX: (targetX - pageLeft) / width,
          destX: mousePos ? mousePos.x - rect.left : undefined,
          destY: mousePos ? mousePos.y - rect.top : undefined
        }
      } else {
        const calculatedTop = getPageTop(
          page,
          scale.value,
          pageSizesConstant.value,
          pageSizesArray.value,
          pageHeightAccumulator.value
        )

        anchor = {
          page,
          ratioY: (targetY - calculatedTop) / size.height,
          ratioX: 0.5,
          destX: mousePos ? mousePos.x - rect.left : undefined,
          destY: mousePos ? mousePos.y - rect.top : undefined
        }
      }
    }

    return anchor
  }

  /**
   * 恢复缩放前的位置锚点
   * 优先使用纯计算模式避免强制同步布局，必要时回退到实时读取
   * @param anchor - 锚点信息
   * @param targetScale - 目标缩放比例
   */
  function restoreAnchor(anchor: ZoomAnchor, targetScale?: number): void {
    const container = containerRef.value
    if (!container) {
      console.warn('Cannot restore anchor: container not found')
      return
    }

    let height: number
    let width: number
    let offsetTop: number
    let offsetLeft: number

    // 纯计算模式：根据缩放比例和页面尺寸计算理论布局
    // 避免读取 offsetHeight/offsetTop 等会触发强制同步布局的属性
    if (targetScale !== undefined && pageSizesConstant.value) {
      // 获取目标缩放比例下的页面尺寸
      const size = getScaledPageSize(
        anchor.page,
        targetScale,
        pageSizesConstant.value,
        null
      )
      height = size.height
      width = size.width
      
      // 计算页面顶部位置（垂直方向是线性累加，可以准确计算）
      offsetTop = getPageTop(
        anchor.page,
        targetScale,
        pageSizesConstant.value,
        pageSizesArray.value,
        pageHeightAccumulator.value
      )
      
      // 计算页面左侧位置：水平居中
      // 当页面宽度小于容器时居中，大于容器时左对齐（offsetLeft = 0）
      // 注意：这里假设 CSS 使用 flex + items-center 布局
      offsetLeft = width <= container.clientWidth
        ? Math.round((container.clientWidth - width) / 2)
        : 0
    } else {
      // 回退模式：实时读取 DOM（变长页面或无页面尺寸信息时）
      const refs = pageRefs.get(anchor.page)
      if (!refs) {
        console.warn(`Cannot restore anchor: page ${anchor.page} refs not found, will retry`)
        nextTick(() => {
          if (pendingAnchor.value) {
            restoreAnchor(pendingAnchor.value)
          }
        })
        return
      }
      height = refs.container.offsetHeight || refs.container.clientHeight
      width = refs.container.offsetWidth || refs.container.clientWidth
      offsetTop = refs.container.offsetTop
      offsetLeft = refs.container.offsetLeft
    }

    if (!height || !width) return

    // 计算锚点内容点在缩放后的文档坐标
    const targetContentY = offsetTop + anchor.ratioY * height
    const targetContentX = offsetLeft + anchor.ratioX * width

    let top = 0
    let left = 0

    if (anchor.destX !== undefined && anchor.destY !== undefined) {
      // 鼠标缩放：保持鼠标指向的内容点在屏幕上的同一位置
      // destX/destY 是鼠标相对于容器左上角的偏移，缩放过程中保持不变
      top = targetContentY - anchor.destY
      left = targetContentX - anchor.destX
    } else {
      // 中心缩放：保持锚点内容点在容器中心
      top = targetContentY - container.clientHeight / 2
      left = targetContentX - container.clientWidth / 2
    }

    // 限制在合法滚动范围内以防止过度修正
    const maxScrollTop = container.scrollHeight - container.clientHeight
    const maxScrollLeft = container.scrollWidth - container.clientWidth

    container.scrollTo({
      top: Math.round(Math.max(0, Math.min(top, maxScrollTop))),
      left: Math.round(Math.max(0, Math.min(left, maxScrollLeft))),
      behavior: 'instant' as ScrollBehavior
    })
  }

  /**
   * 设置待处理的锚点
   */
  function setPendingAnchor(anchor: ZoomAnchor | null): void {
    pendingAnchor.value = anchor
  }

  /**
   * 清除待处理的锚点
   */
  function clearPendingAnchor(): void {
    pendingAnchor.value = null
  }

  return {
    pendingAnchor,
    captureCenterAnchor,
    restoreAnchor,
    setPendingAnchor,
    clearPendingAnchor
  }
}
