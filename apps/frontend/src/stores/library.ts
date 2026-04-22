/*
----------------------------------------------------------------------
                          PDF library state
----------------------------------------------------------------------
*/
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import { pdfApi } from '../api'
import { getPdfFromCache, savePdfToCache } from '../utils/pdfCache'
import type { RecentImportKind, RecentImportTask } from '../types'

const LIBRARY_CURRENT_KEY = 'readme_library_current'

type RecentImportRetryPayload =
  | { kind: 'file'; file: File }
  | { kind: 'link'; input: string }

export const useLibraryStore = defineStore('library', () => {
  const currentDocumentId = ref<string | null>(sessionStorage.getItem(LIBRARY_CURRENT_KEY) || null)
  const lastReadMap = useStorage<Record<string, number>>('readme_last_read_at', {})

  // Cache object URLs so the same document is not recreated repeatedly.
  const blobUrlCache = new Map<string, string>()
  // Reuse the same in-flight load when the user clicks the same document repeatedly.
  const pendingBlobUrlLoads = new Map<string, Promise<string>>()

  const recentImportTasks = ref<RecentImportTask[]>([])
  const recentImportPayloads = new Map<string, RecentImportRetryPayload>()
  const processingStreamPdfId = ref<string | null>(null)

  watch(currentDocumentId, (newId) => {
    if (newId) sessionStorage.setItem(LIBRARY_CURRENT_KEY, newId)
    else sessionStorage.removeItem(LIBRARY_CURRENT_KEY)
  })

  function createRecentImportId(kind: RecentImportKind) {
    return `recent-import-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function upsertRecentImportTask(task: RecentImportTask) {
    const next = recentImportTasks.value.filter(item => item.id !== task.id)
    next.unshift(task)
    next.sort((a, b) => b.updatedAt - a.updatedAt)
    recentImportTasks.value = next
  }

  function startRecentImport(
    kind: RecentImportKind,
    payload: RecentImportRetryPayload,
    name: string,
  ) {
    const now = Date.now()
    const id = createRecentImportId(kind)
    recentImportPayloads.set(id, payload)
    upsertRecentImportTask({
      id,
      kind,
      name,
      status: 'pending',
      error: null,
      createdAt: now,
      updatedAt: now,
    })
    return id
  }

  function startRecentFileImport(file: File) {
    return startRecentImport('file', { kind: 'file', file }, file.name)
  }

  function startRecentLinkImport(input: string) {
    const trimmed = input.trim()
    const fallbackName = trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed
    return startRecentImport('link', { kind: 'link', input: trimmed }, fallbackName || 'Importing paper')
  }

  function markRecentImportPending(id: string) {
    const existing = recentImportTasks.value.find(item => item.id === id)
    if (!existing) return null

    const nextTask: RecentImportTask = {
      ...existing,
      status: 'pending',
      error: null,
      updatedAt: Date.now(),
    }
    upsertRecentImportTask(nextTask)
    return nextTask
  }

  function markRecentImportFailed(id: string, error: string) {
    const existing = recentImportTasks.value.find(item => item.id === id)
    if (!existing) return null

    const nextTask: RecentImportTask = {
      ...existing,
      status: 'failed',
      error,
      updatedAt: Date.now(),
    }
    upsertRecentImportTask(nextTask)
    return nextTask
  }

  function resolveRecentImport(id: string) {
    recentImportTasks.value = recentImportTasks.value.filter(item => item.id !== id)
    recentImportPayloads.delete(id)
  }

  function prepareRecentImportRetry(id: string) {
    const payload = recentImportPayloads.get(id)
    if (!payload) return null
    markRecentImportPending(id)
    return payload
  }

  function setProcessingStreamPdfId(pdfId: string | null) {
    processingStreamPdfId.value = pdfId
  }

  function clearProcessingStreamPdfId(pdfId?: string) {
    if (!pdfId || processingStreamPdfId.value === pdfId) {
      processingStreamPdfId.value = null
    }
  }

  async function loadDocumentBlob(id: string) {
    const cachedUrl = blobUrlCache.get(id)
    if (cachedUrl) {
      return cachedUrl
    }

    const pendingLoad = pendingBlobUrlLoads.get(id)
    if (pendingLoad) {
      return pendingLoad
    }

    const loadPromise = (async () => {
      try {
        let blob = await getPdfFromCache(id)
        if (!blob || !(blob instanceof Blob)) {
          blob = await pdfApi.getSource(id)
          savePdfToCache(id, blob).catch(error => {
            console.warn('[Library] IDB cache write failed:', error)
          })
        }

        const url = URL.createObjectURL(blob)
        blobUrlCache.set(id, url)
        return url
      } catch (error: any) {
        console.error(`Failed to load source for PDF ${id}:`, error)
        throw error
      } finally {
        pendingBlobUrlLoads.delete(id)
      }
    })()

    pendingBlobUrlLoads.set(id, loadPromise)
    return loadPromise
  }

  async function selectDocument(id: string) {
    const url = await loadDocumentBlob(id)
    currentDocumentId.value = id
    lastReadMap.value[id] = Date.now()
    const pdfStore = (await import('./pdf')).usePdfStore()
    await pdfStore.setCurrentPdf(url, id)
  }

  function clearLibrary() {
    currentDocumentId.value = null
    processingStreamPdfId.value = null
    sessionStorage.removeItem(LIBRARY_CURRENT_KEY)
    recentImportTasks.value = []
    recentImportPayloads.clear()
    pendingBlobUrlLoads.clear()
  }

  async function addDocument(file: File) {
    try {
      const response = await pdfApi.upload(file)
      if (response && response.pdfId) {
        return response.pdfId
      }
      throw new Error('Upload failed: No PDF ID returned')
    } catch (error: any) {
      console.error('Failed to upload document:', error)
      throw error
    }
  }

  return {
    currentDocumentId,
    processingStreamPdfId,
    lastReadMap,
    recentImportTasks,
    startRecentFileImport,
    startRecentLinkImport,
    markRecentImportPending,
    markRecentImportFailed,
    resolveRecentImport,
    prepareRecentImportRetry,
    setProcessingStreamPdfId,
    clearProcessingStreamPdfId,
    selectDocument,
    loadDocumentBlob,
    addDocument,
    clearLibrary,
    blobUrlCache,
  }
})
