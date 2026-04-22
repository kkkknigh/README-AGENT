import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { pdfApi } from '../../api'
import { usePdfStore } from '../../stores/pdf'
import { watch, ref, computed, unref, type Ref } from 'vue'
import { STORES, dbGet } from '../../utils/db'

// 全局记录已接收到的页码，确保轮询从正确的位置开始
const receivedUpToPage = ref<Record<string, number>>({})
const readerStreamConnected = ref<Record<string, boolean>>({})
const readerStreamPending = ref<Record<string, boolean>>({})

/**
 * 更新指定文档的已接收进度
 * @param pdfId
 * @param page
 */
export const updateReceivedUpToPage = (pdfId: string, page: number) => {
  if (pdfId) {
    const current = receivedUpToPage.value[pdfId] ?? 0
    if (page > current) {
      receivedUpToPage.value[pdfId] = page
    }
  }
}

export const setReaderStreamConnected = (pdfId: string, connected: boolean) => {
  if (!pdfId) return
  readerStreamConnected.value[pdfId] = connected
}

export const setReaderStreamPending = (pdfId: string, pending: boolean) => {
  if (!pdfId) return
  readerStreamPending.value[pdfId] = pending
}

const isReaderStreamConnected = (pdfId: string | null | undefined) => {
  return !!(pdfId && readerStreamConnected.value[pdfId])
}

const isReaderStreamPending = (pdfId: string | null | undefined) => {
  return !!(pdfId && readerStreamPending.value[pdfId])
}

/**
 * 获取 PDF 解析状态及进度轮询
 * @param pdfIdRef PDF 文档 ID (响应式)
 */
export const usePdfStatusQuery = (pdfIdRef: Ref<string | null> | (() => string | null) | string | null) => {
  const pdfId = computed(() => (typeof pdfIdRef === 'function' ? pdfIdRef() : unref(pdfIdRef)))
  const pdfStore = usePdfStore()

  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['pdf-status', pdfId],
    queryFn: async () => {
      if (!pdfId.value) return null
      // IDB-first：段落已缓存说明文档已有内容，不必从第 1 页重新拉
      if (!queryClient.getQueryData(['pdf-status', pdfId.value])) {
        const cached = await dbGet<{ id: string; paragraphs: any[]; layout?: any[] }>(STORES.PDF_PARAGRAPHS, pdfId.value).catch(() => null)
        if (cached?.paragraphs?.length) {
          const maxPage = Math.max(...cached.paragraphs.map((p: any) => p.page))
          updateReceivedUpToPage(pdfId.value, maxPage)
          if (cached.layout?.length) {
            pdfStore.setLayoutOverlays(pdfId.value, cached.layout)
          }
          return { status: 'completed', paragraphs: [], layout: null, currentPage: maxPage }
        }
      }
      const fromPage = (receivedUpToPage.value[pdfId.value] ?? 0) + 1
      const result = await pdfApi.getStatus(pdfId.value, fromPage)
      return result
    },
    enabled: computed(() =>
      !!pdfId.value
      && !isReaderStreamConnected(pdfId.value)
      && !isReaderStreamPending(pdfId.value)
    ),
    // 根据状态决定是否继续轮询
    refetchInterval: (query) => {
      if (isReaderStreamConnected(pdfId.value) || isReaderStreamPending(pdfId.value)) {
        return false
      }
      const data = query.state.data as any
      if (
        data?.status === 'completed'
        || data?.status === 'failed'
        || data?.status === 'not_found'
        || data?.status === 'error'
      ) {
        return false
      }
      return 2000
    },
  })

  // 监听数据变化，执行副作用（更新 Store）
  watch(() => query.data.value, (result) => {
    try {
      if (!result || !pdfId.value) return

      if (result.paragraphs && result.paragraphs.length > 0) {
        pdfStore.ingestParagraphs(pdfId.value, result.paragraphs)
      }

      if (result.layout && pdfId.value) {
        pdfStore.appendLayoutOverlays(pdfId.value, result.layout)
      }

      if (result.currentPage > (receivedUpToPage.value[pdfId.value] ?? 0)) {
        receivedUpToPage.value[pdfId.value] = result.currentPage
      }

      if (result.status === 'completed' && pdfId.value) {
        if (!pdfStore.layoutOverlays.length) {
          pdfStore.fetchLayoutForPdf(pdfId.value)
        }
        pdfStore.prewarmWholeCitations(pdfId.value).catch(e =>
          console.warn('prewarm whole citations failed:', e)
        )
      }
    } catch (error) {
      console.error('[usePdfStatusQuery] Error processing PDF status result:', error)
    }
  }, { immediate: true })

  return query
}
