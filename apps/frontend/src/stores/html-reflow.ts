/**
 * HTML 重排状态管理
 *
 * 管理 PDF/HTML 视图切换、双语模式、HTML 内容加载与缓存。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { htmlApi } from '../api'
import { dbGet, dbPut, STORES } from '../utils/db'
import type { BlockMapping, BilingualMode, ReaderViewMode } from '../types'

type HtmlCacheRecord = {
  id: string
  htmlContent?: string
  mapping?: BlockMapping[]
  htmlSource?: string
  status?: string
  cachedAt?: number
}

export const useHtmlReflowStore = defineStore('html-reflow', () => {
  const viewMode = useStorage<ReaderViewMode>('readme_view_mode', 'pdf', sessionStorage)
  const bilingualMode = useStorage<BilingualMode>('readme_bilingual_mode', 'english', sessionStorage)

  const htmlContent = ref<string | null>(null)
  const blockMapping = ref<BlockMapping[]>([])
  const htmlSource = ref<string | null>(null)
  const htmlStatus = ref<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const currentPdfId = ref<string | null>(null)
  const isRegenerating = ref(false)
  const regeneratingPdfId = ref<string | null>(null)
  const requestingHtmlPdfId = ref<string | null>(null)
  const staleHtmlPdfId = ref<string | null>(null)
  const pendingHtmlLoads = new Map<string, Promise<void>>()
  const pendingHtmlRequests = new Map<string, Promise<void>>()
  let regeneratePollToken = 0
  let requestPollToken = 0

  function resetHtmlRuntime(pdfId?: string | null) {
    if (pdfId && currentPdfId.value && currentPdfId.value !== pdfId) return
    htmlContent.value = null
    blockMapping.value = []
    htmlSource.value = null
    htmlStatus.value = 'idle'
  }

  function markHtmlError(pdfId?: string | null) {
    if (pdfId && currentPdfId.value && currentPdfId.value !== pdfId) return
    htmlStatus.value = 'error'
  }

  function stopRegenerationTracking(pdfId?: string | null, clearStale = false) {
    if (pdfId && regeneratingPdfId.value && regeneratingPdfId.value !== pdfId) return
    regeneratePollToken += 1
    if (!pdfId || regeneratingPdfId.value === pdfId) {
      isRegenerating.value = false
      regeneratingPdfId.value = null
    }
    if (clearStale && (!pdfId || staleHtmlPdfId.value === pdfId)) {
      staleHtmlPdfId.value = null
    }
  }

  function stopHtmlRequestTracking(pdfId?: string | null) {
    requestPollToken += 1
    if (!pdfId || requestingHtmlPdfId.value === pdfId) {
      requestingHtmlPdfId.value = null
    }
  }

  async function pollRequestedHtmlStatus(pdfId: string, token: number) {
    while (token === requestPollToken && requestingHtmlPdfId.value === pdfId) {
      try {
        const meta = await htmlApi.getHtml(pdfId)
        if (token !== requestPollToken || requestingHtmlPdfId.value !== pdfId) return

        if (meta?.html_content) {
          stopHtmlRequestTracking(pdfId)
          await loadHtml(pdfId, meta)
          return
        }

        if (meta?.status === 'failed') {
          stopHtmlRequestTracking(pdfId)
          markHtmlError(pdfId)
          return
        }
      } catch (e: any) {
        if (token !== requestPollToken || requestingHtmlPdfId.value !== pdfId) return
        if (e?.response?.status && e.response.status !== 404) {
          console.error('[HtmlReflow] HTML request poll failed:', e)
          stopHtmlRequestTracking(pdfId)
          markHtmlError(pdfId)
          return
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }

  async function pollRegenerationStatus(pdfId: string, token: number) {
    while (token === regeneratePollToken && regeneratingPdfId.value === pdfId) {
      try {
        const meta = await htmlApi.getHtml(pdfId)
        if (token !== regeneratePollToken) return

        if (meta?.status === 'failed') {
          stopRegenerationTracking(pdfId, true)
          return
        }

        if (meta?.status === 'completed') {
          stopRegenerationTracking(pdfId)
          return
        }
      } catch (e: any) {
        if (token !== regeneratePollToken) return
        if (e?.response?.status && e.response.status !== 404) {
          console.warn('[HtmlReflow] Regeneration poll failed:', e)
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }

  async function loadHtml(pdfId: string, prefetchedMeta?: any, fromRequest: boolean = false) {
    if (!prefetchedMeta && !fromRequest) {
      const pendingRequest = pendingHtmlRequests.get(pdfId)
      if (pendingRequest) {
        return pendingRequest
      }
    }

    const pendingLoad = pendingHtmlLoads.get(pdfId)
    if (pendingLoad) {
      return pendingLoad
    }

    const loadPromise = (async () => {
      const shouldBypassCache = staleHtmlPdfId.value === pdfId
      if (!shouldBypassCache && currentPdfId.value === pdfId && htmlStatus.value === 'loaded' && htmlContent.value) return

      htmlStatus.value = 'loading'
      currentPdfId.value = pdfId

      try {
        const cached = shouldBypassCache ? null : await dbGet<HtmlCacheRecord>(STORES.HTML_CONTENT, pdfId)
        if (cached?.htmlContent) {
          const age = Date.now() - (cached.cachedAt || 0)
          const hasUnresolvedImages = /<img[^>]+src="(?:images\/|extracted\/|\/html\/)/.test(cached.htmlContent)
          const missingBlockIds = !cached.htmlContent.includes('data-block-id=')
          const hasCitationPlaceholder = cached.htmlContent.includes('ADDCITATIONS')
          if (age < 30 * 24 * 60 * 60 * 1000 && !hasUnresolvedImages && !missingBlockIds && !hasCitationPlaceholder) {
            htmlContent.value = cached.htmlContent
            blockMapping.value = cached.mapping || []
            htmlSource.value = cached.htmlSource || null
            htmlStatus.value = 'loaded'
            return
          }
        }

        const meta = prefetchedMeta ?? await htmlApi.getHtml(pdfId)
        if (!meta?.html_content) {
          markHtmlError(pdfId)
          return
        }

        htmlSource.value = meta.source || null
        htmlContent.value = meta.html_content

        const rawMapping = meta.mapping || {}
        blockMapping.value = (rawMapping.blocks || []).map((b: any) => ({
          blockId: b.block_id,
          type: b.type,
          paragraphId: b.paragraph_id,
          page: b.page,
          paragraphIndex: b.paragraph_index,
        }))

        await dbPut(STORES.HTML_CONTENT, {
          id: pdfId,
          htmlContent: meta.html_content,
          mapping: blockMapping.value,
          htmlSource: meta.source,
          status: 'completed',
          cachedAt: Date.now(),
        })

        if (staleHtmlPdfId.value === pdfId) {
          staleHtmlPdfId.value = null
        }
        stopHtmlRequestTracking(pdfId)
        htmlStatus.value = 'loaded'
      } catch (e) {
        console.error('[HtmlReflow] Failed to load HTML:', e)
        stopHtmlRequestTracking(pdfId)
        markHtmlError(pdfId)
      }
    })()

    pendingHtmlLoads.set(pdfId, loadPromise)
    try {
      return await loadPromise
    } finally {
      if (pendingHtmlLoads.get(pdfId) === loadPromise) {
        pendingHtmlLoads.delete(pdfId)
      }
    }
  }

  async function requestHtml(pdfId: string) {
    viewMode.value = 'html'

    const pendingRequest = pendingHtmlRequests.get(pdfId)
    if (pendingRequest) {
      return pendingRequest
    }

    if (requestingHtmlPdfId.value === pdfId && htmlStatus.value === 'loading') {
      return
    }

    const requestPromise = (async () => {
      const shouldBypassCache = staleHtmlPdfId.value === pdfId

      if (!shouldBypassCache && currentPdfId.value === pdfId && htmlStatus.value === 'loaded' && htmlContent.value) {
        return
      }

      const cached = shouldBypassCache ? null : await dbGet<HtmlCacheRecord>(STORES.HTML_CONTENT, pdfId)
      if (cached?.status === 'completed' && cached.htmlContent) {
        await loadHtml(pdfId, undefined, true)
        return
      }

      requestPollToken += 1
      const token = requestPollToken
      requestingHtmlPdfId.value = pdfId
      currentPdfId.value = pdfId
      resetHtmlRuntime(pdfId)
      htmlStatus.value = 'loading'

      try {
        const meta = await htmlApi.getHtml(pdfId)
        if (meta?.html_content) {
          await loadHtml(pdfId, meta, true)
          return
        }

        if (meta?.status !== 'pending' && meta?.status !== 'fetching') {
          await htmlApi.fetchHtml(pdfId, { force: meta?.status === 'completed' })
        }
        void pollRequestedHtmlStatus(pdfId, token)
      } catch (e: any) {
        if (e?.response?.status === 404) {
          try {
            await htmlApi.fetchHtml(pdfId)
            void pollRequestedHtmlStatus(pdfId, token)
            return
          } catch (fetchError) {
            console.error('[HtmlReflow] Trigger fetch failed:', fetchError)
            stopHtmlRequestTracking(pdfId)
            markHtmlError(pdfId)
            return
          }
        }

        if (e?.response?.status) {
          console.error('[HtmlReflow] Failed to query HTML:', e)
          stopHtmlRequestTracking(pdfId)
          markHtmlError(pdfId)
          return
        }
        console.error('[HtmlReflow] Failed to request HTML:', e)
        stopHtmlRequestTracking(pdfId)
        markHtmlError(pdfId)
      }
    })()

    pendingHtmlRequests.set(pdfId, requestPromise)
    try {
      return await requestPromise
    } finally {
      if (pendingHtmlRequests.get(pdfId) === requestPromise) {
        pendingHtmlRequests.delete(pdfId)
      }
    }
  }

  function setBilingualMode(mode: BilingualMode) {
    bilingualMode.value = mode
  }

  async function regenerateHtml(pdfId: string) {
    if (regeneratingPdfId.value === pdfId) return

    regeneratePollToken += 1
    const token = regeneratePollToken
    isRegenerating.value = true
    regeneratingPdfId.value = pdfId
    staleHtmlPdfId.value = pdfId

    try {
      await htmlApi.fetchHtml(pdfId, { force: true })
      void pollRegenerationStatus(pdfId, token)
    } catch (e) {
      console.error('[HtmlReflow] Regenerate failed:', e)
      stopRegenerationTracking(pdfId, true)
    }
  }

  function getMappingForBlock(blockId: number): BlockMapping | undefined {
    return blockMapping.value.find(b => b.blockId === blockId)
  }

  function $reset() {
    stopHtmlRequestTracking()
    stopRegenerationTracking(undefined, true)
    resetHtmlRuntime()
    currentPdfId.value = null
    pendingHtmlLoads.clear()
    pendingHtmlRequests.clear()
  }

  return {
    viewMode,
    bilingualMode,
    htmlContent,
    blockMapping,
    htmlSource,
    htmlStatus,
    currentPdfId,
    isRegenerating,
    regeneratingPdfId,
    loadHtml,
    setBilingualMode,
    requestHtml,
    regenerateHtml,
    resetHtmlRuntime,
    getMappingForBlock,
    $reset,
  }
})
