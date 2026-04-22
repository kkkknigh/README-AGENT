import { ref } from 'vue'
import type { PdfParagraph } from '../types'
import { aiApi, pdfApi } from '../api'
import { useTranslationStore } from './translation'

export function usePdfTranslationState() {
    const translationStore = useTranslationStore()

    type PageTranslationState = 'idle' | 'pending' | 'loading' | 'failed' | 'success'

    const pageTranslationStatus = ref<Record<number, PageTranslationState>>({})
    const fullTranslationStatus = ref<'idle' | 'loading' | 'done' | 'error'>('idle')
    const inFlightPageRequests = new Map<number, Promise<void>>()

    function isTranslatableParagraph(paragraph: PdfParagraph): boolean {
        return typeof paragraph.content === 'string' && paragraph.content.trim().length > 0
    }

    function getCachedTranslation(paragraph: PdfParagraph): string {
        const cachedByStore = translationStore.translatedParagraphsCache.get(paragraph.id)
        if (typeof cachedByStore === 'string' && cachedByStore.trim()) return cachedByStore

        return paragraph.translation || ''
    }

    function isPageFullyTranslated(pageParagraphs: PdfParagraph[]): boolean {
        const translatableParagraphs = pageParagraphs.filter(isTranslatableParagraph)
        if (!translatableParagraphs.length) return true
        return translatableParagraphs.every((p) => getCachedTranslation(p).trim().length > 0)
    }

    function buildTranslatableRequestPayload(pageParagraphs: PdfParagraph[]) {
        return pageParagraphs
            .filter(isTranslatableParagraph)
            .map((paragraph) => ({
                paragraphId: paragraph.id,
                content: paragraph.content.trim(),
            }))
            .filter((paragraph) => paragraph.paragraphId && paragraph.content)
    }

    async function ensurePageParagraphs(
        pageNumber: number,
        pdfId: string,
        allParagraphs: Record<string, PdfParagraph[]>
    ): Promise<PdfParagraph[]> {
        const docParagraphs = allParagraphs[pdfId] ?? []
        let pageParagraphs = docParagraphs.filter((p) => p.page === pageNumber)
        console.info(`[FullTranslation] page=${pageNumber} localParagraphs=${pageParagraphs.length}`)

        if (!pageParagraphs.length) {
            const response = await pdfApi.getParagraphs(pdfId, pageNumber)
            const fetchedParagraphs = response.paragraphs || []
            console.info(`[FullTranslation] page=${pageNumber} fetchedParagraphs=${fetchedParagraphs.length}`)

            if (fetchedParagraphs.length) {
                const existing = allParagraphs[pdfId] ?? []
                const merged = [...existing]
                const existingIds = new Set(existing.map((item) => item.id))
                for (const paragraph of fetchedParagraphs) {
                    if (!existingIds.has(paragraph.id)) {
                        merged.push(paragraph)
                        existingIds.add(paragraph.id)
                    }
                }
                allParagraphs[pdfId] = merged
                pageParagraphs = merged.filter((p) => p.page === pageNumber)
            }
        }

        return pageParagraphs
    }

    const CONCURRENT_PAGE_LIMIT = 3

    async function startFullPreTranslation(
        pdfId: string,
        totalPages: number,
        allParagraphs: Record<string, PdfParagraph[]>
    ) {
        if (fullTranslationStatus.value === 'loading') return

        fullTranslationStatus.value = 'loading'
        let hasFailedPage = false

        try {
            for (let i = 1; i <= totalPages; i++) {
                const status = pageTranslationStatus.value[i]
                if (!status || status === 'idle' || status === 'failed') {
                    pageTranslationStatus.value[i] = 'pending'
                }
            }

            for (let i = 1; i <= totalPages; i += CONCURRENT_PAGE_LIMIT) {
                const batch = Array.from(
                    { length: Math.min(CONCURRENT_PAGE_LIMIT, totalPages - i + 1) },
                    (_, k) => i + k
                )
                await Promise.all(
                    batch.map((page) => startPageStreamingTranslation(page, pdfId, allParagraphs))
                )
                for (const page of batch) {
                    if (pageTranslationStatus.value[page] === 'failed') {
                        hasFailedPage = true
                    }
                }
            }
            fullTranslationStatus.value = hasFailedPage ? 'error' : 'done'
        } catch (e) {
            console.error('[FullTranslation] interrupted:', e)
            fullTranslationStatus.value = 'error'
        }
    }

    async function startPageStreamingTranslation(
        pageNumber: number,
        pdfId: string,
        allParagraphs: Record<string, PdfParagraph[]>
    ) {
        const currentStatus = pageTranslationStatus.value[pageNumber]
        if (currentStatus === 'success') return

        const inFlight = inFlightPageRequests.get(pageNumber)
        if (currentStatus === 'loading' && inFlight) {
            await inFlight
            return
        }

        if (!currentStatus || currentStatus === 'idle' || currentStatus === 'failed') {
            pageTranslationStatus.value[pageNumber] = 'pending'
        }

        const task = (async () => {
            const pageParagraphs = await ensurePageParagraphs(pageNumber, pdfId, allParagraphs)

            if (!pageParagraphs.length) {
                console.warn(`[FullTranslation] page=${pageNumber} has no paragraphs after fetch; marking failed`)
                pageTranslationStatus.value[pageNumber] = 'failed'
                return
            }

            if (isPageFullyTranslated(pageParagraphs)) {
                console.info(`[FullTranslation] page=${pageNumber} fully cached; skipping request`)
                pageTranslationStatus.value[pageNumber] = 'success'
                return
            }

            const paragraphsToTranslate = buildTranslatableRequestPayload(pageParagraphs)

            if (!paragraphsToTranslate.length) {
                console.info(`[FullTranslation] page=${pageNumber} has no translatable paragraphs; marking success`)
                pageTranslationStatus.value[pageNumber] = 'success'
                return
            }

            pageTranslationStatus.value[pageNumber] = 'loading'
            let historyCount = 0
            let translatedCount = 0
            let failedCount = 0

            console.info(`[FullTranslation] page=${pageNumber} requestParagraphs=${paragraphsToTranslate.length}`)

            await aiApi.translateFullPage(
                pdfId,
                paragraphsToTranslate,
                (data) => {
                    if (data.type === 'history' && Array.isArray(data.translations)) {
                        historyCount += data.translations.length
                        data.translations.forEach((item: any) => {
                            if (typeof item.translation === 'string' && item.translation.trim()) {
                                translationStore.syncTranslatedParagraph(item.paragraphId, item.translation, pdfId)
                            }
                        })
                    } else if (data.type === 'translation') {
                        translatedCount += 1
                        if (typeof data.translation === 'string' && data.translation.trim()) {
                            translationStore.syncTranslatedParagraph(data.paragraphId, data.translation, pdfId)
                        } else {
                            failedCount += 1
                        }
                    } else if (data.type === 'failure') {
                        failedCount += 1
                    }
                },
                () => {
                    const finalStatus = failedCount > 0 ? 'failed' : 'success'
                    console.info(
                        `[FullTranslation] page=${pageNumber} done historyCount=${historyCount} newTranslations=${translatedCount} failed=${failedCount}`
                    )
                    pageTranslationStatus.value[pageNumber] = finalStatus
                },
                (err) => {
                    console.error(`[FullTranslation] page=${pageNumber} failed:`, err)
                    pageTranslationStatus.value[pageNumber] = 'failed'
                }
            )
        })()

        // 先注册再 await，避免并发调用在 set 之前检查 inFlight 导致绕过去重
        inFlightPageRequests.set(pageNumber, task)
        try {
            await task
        } finally {
            inFlightPageRequests.delete(pageNumber)
        }
    }

    return {
        pageTranslationStatus,
        fullTranslationStatus,
        startPageStreamingTranslation,
        startFullPreTranslation
    }
}
