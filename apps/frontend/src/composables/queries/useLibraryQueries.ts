import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import axios from 'axios'
import { libraryApi } from '../../api'
import type { PdfDocument } from '../../types'
import { broadcastSync } from '../../utils/broadcast'
import { STORES, dbDelete, dbDeleteMany, dbGetAll, dbPut, dbPutMany } from '../../utils/db'
import { useLibraryStore } from '../../stores/library'

export type DocumentsQueryParams = {
  page?: number
  pageSize?: number
  group?: string
  keyword?: string
}

type DocumentsSearchResult = {
  items: PdfDocument[]
  total: number
}

export function normalizeDocumentsQueryParams(params?: DocumentsQueryParams) {
  const normalized: DocumentsQueryParams = {
    page: params?.page ?? 1,
  }
  if (params?.pageSize) {
    normalized.pageSize = params.pageSize
  }

  if (params?.group?.trim()) {
    normalized.group = params.group.trim()
  }
  if (params?.keyword?.trim()) {
    normalized.keyword = params.keyword.trim()
  }

  return normalized
}

function shouldSyncDocumentsToDb(params: DocumentsQueryParams) {
  return !params.group && !params.keyword && (params.page ?? 1) === 1
}

function mapLibraryItemToDocument(item: any): PdfDocument {
  return {
    id: item.pdfId,
    name: item.title,
    url: '',
    uploadedAt: item.addedAt ? new Date(item.addedAt) : new Date(),
    pageCount: item.totalPages || 0,
    tags: item.tags || [],
    authors: Array.isArray(item.authors) ? item.authors : [],
  }
}

async function fetchDocumentsResult(params: DocumentsQueryParams): Promise<DocumentsSearchResult> {
  const data = await libraryApi.list(params)
  const docs = Array.isArray(data?.items) ? data.items.map(mapLibraryItemToDocument) : []
  return {
    items: docs,
    total: typeof data?.total === 'number' ? data.total : docs.length,
  }
}

function getImportErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data
    if (typeof payload === 'string' && payload.trim()) return payload.trim()
    if (payload && typeof payload === 'object') {
      const responseError = 'error' in payload ? payload.error : null
      const responseMessage = 'message' in payload ? payload.message : null
      if (typeof responseError === 'string' && responseError.trim()) return responseError.trim()
      if (typeof responseMessage === 'string' && responseMessage.trim()) return responseMessage.trim()
    }
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim()
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  return fallback
}

export const useDocumentsQuery = (params?: MaybeRefOrGetter<DocumentsQueryParams | undefined>) => {
  const queryClient = useQueryClient()
  const resolvedParams = computed(() => normalizeDocumentsQueryParams(toValue(params)))

  return useQuery({
    queryKey: computed(() => ['documents', resolvedParams.value]),
    queryFn: async (): Promise<PdfDocument[]> => {
      // 冷启动 + 无筛选首页 → IDB 优先
      const qk = ['documents', resolvedParams.value]
      if (!queryClient.getQueryData(qk) && shouldSyncDocumentsToDb(resolvedParams.value)) {
        const cached = await dbGetAll(STORES.LIBRARY).catch(() => [])
        if (cached.length) return cached as PdfDocument[]
      }
      const result = await fetchDocumentsResult(resolvedParams.value)
      if (shouldSyncDocumentsToDb(resolvedParams.value)) {
        dbPutMany(STORES.LIBRARY, result.items).catch(e => console.warn('[DB] Sync library failed:', e))
      }
      return result.items
    },
    placeholderData: previousData => previousData,
    // 文献列表是侧边栏核心数据，允许在数据为空时自动重新验证
    // 覆盖全局 staleTime: Infinity，确保首次加载失败后可恢复
    staleTime: 1000 * 60 * 5, // 5 分钟后视为过期
    retry: 2,
  })
}

export const useDocumentSearchQuery = (
  params: MaybeRefOrGetter<DocumentsQueryParams | undefined>,
  enabled: MaybeRefOrGetter<boolean> = true,
) => {
  const resolvedParams = computed(() => normalizeDocumentsQueryParams(toValue(params)))

  return useQuery({
    queryKey: computed(() => ['documents-search', resolvedParams.value]),
    queryFn: () => fetchDocumentsResult(resolvedParams.value),
    placeholderData: previousData => previousData,
    enabled: computed(() => toValue(enabled)),
  })
}

export const useDeleteDocumentMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pdfId: string) => libraryApi.delete(pdfId),
    onMutate: async (pdfId) => {
      await queryClient.cancelQueries({ queryKey: ['documents'] })
      const previousDocs = queryClient.getQueryData<PdfDocument[]>(['documents', normalizeDocumentsQueryParams()])
      if (previousDocs) {
        queryClient.setQueryData(
          ['documents', normalizeDocumentsQueryParams()],
          previousDocs.filter(doc => doc.id !== pdfId)
        )
      }
      return { previousDocs }
    },
    onError: (_err, _pdfId, context) => {
      if (context?.previousDocs) {
        queryClient.setQueryData(['documents', normalizeDocumentsQueryParams()], context.previousDocs)
      }
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['documents-search'] })
    },
    onSuccess: (_data, pdfId) => {
      // 服务端确认删除后再级联清理 IDB，避免失败时数据不可恢复
      dbDelete(STORES.LIBRARY, pdfId).catch(console.warn)
      dbDelete(STORES.PDFS, pdfId).catch(console.warn)
      dbDelete(STORES.HIGHLIGHTS, pdfId).catch(console.warn)
      dbDelete(STORES.BRIEFS, pdfId).catch(console.warn)
      dbDelete(STORES.ROADMAPS, pdfId).catch(console.warn)
      dbDelete(STORES.PDF_PARAGRAPHS, pdfId).catch(console.warn)
      dbDelete(STORES.NOTES, pdfId).catch(console.warn)
      dbGetAll(STORES.TRANSLATIONS).then(all => {
        const ids = all.filter((t: any) => t.pdfId === pdfId).map((t: any) => t.id)
        if (ids.length) dbDeleteMany(STORES.TRANSLATIONS, ids).catch(console.warn)
      }).catch(console.warn)
      broadcastSync('RELOAD_LIBRARY')
    },
  })
}

export const useAddTagMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ pdfId, tag }: { pdfId: string, tag: string }) => libraryApi.addTag(pdfId, tag),
    onMutate: async ({ pdfId, tag }) => {
      await queryClient.cancelQueries({ queryKey: ['documents'] })
      const previousDocs = queryClient.getQueryData<PdfDocument[]>(['documents', normalizeDocumentsQueryParams()])
      if (previousDocs) {
        const updatedDocs = previousDocs.map(doc => {
          if (doc.id === pdfId) {
            const tags = doc.tags || []
            if (!tags.includes(tag)) return { ...doc, tags: [...tags, tag] }
          }
          return doc
        })
        queryClient.setQueryData(['documents', normalizeDocumentsQueryParams()], updatedDocs)
      }
      return { previousDocs }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousDocs) {
        queryClient.setQueryData(['documents', normalizeDocumentsQueryParams()], context.previousDocs)
      }
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
    onSuccess: (_data, { pdfId }) => {
      const docs = queryClient.getQueryData<PdfDocument[]>(['documents', normalizeDocumentsQueryParams()])
      const doc = docs?.find(d => d.id === pdfId)
      if (doc) dbPut(STORES.LIBRARY, doc).catch(console.warn)
    },
  })
}

export const useRenameDocumentMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ pdfId, title }: { pdfId: string, title: string }) => libraryApi.rename(pdfId, title),
    onMutate: async ({ pdfId, title }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['documents'] }),
        queryClient.cancelQueries({ queryKey: ['documents-search'] }),
      ])
      queryClient.setQueriesData<PdfDocument[]>({ queryKey: ['documents'] }, (old) =>
        old?.map(doc => (doc.id === pdfId ? { ...doc, name: title } : doc))
      )
      queryClient.setQueriesData<DocumentsSearchResult>({ queryKey: ['documents-search'] }, (old) =>
        old ? { ...old, items: old.items.map(doc => (doc.id === pdfId ? { ...doc, name: title } : doc)) } : old
      )
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['documents-search'] })
    },
    onSuccess: (_data, { pdfId }) => {
      const docs = queryClient.getQueriesData<PdfDocument[]>({ queryKey: ['documents'] })
      const doc = docs.flatMap(([, data]) => data ?? []).find(d => d.id === pdfId)
      if (doc) dbPut(STORES.LIBRARY, doc).catch(console.warn)
      broadcastSync('RELOAD_LIBRARY')
    },
  })
}

export const useRemoveTagMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ pdfId, tag }: { pdfId: string, tag: string }) => libraryApi.removeTag(pdfId, tag),
    onMutate: async ({ pdfId, tag }) => {
      await queryClient.cancelQueries({ queryKey: ['documents'] })
      const previousDocs = queryClient.getQueryData<PdfDocument[]>(['documents', normalizeDocumentsQueryParams()])
      if (previousDocs) {
        const updatedDocs = previousDocs.map(doc => {
          if (doc.id === pdfId && doc.tags) return { ...doc, tags: doc.tags.filter(t => t !== tag) }
          return doc
        })
        queryClient.setQueryData(['documents', normalizeDocumentsQueryParams()], updatedDocs)
      }
      return { previousDocs }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousDocs) {
        queryClient.setQueryData(['documents', normalizeDocumentsQueryParams()], context.previousDocs)
      }
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
    onSuccess: (_data, { pdfId }) => {
      const docs = queryClient.getQueryData<PdfDocument[]>(['documents', normalizeDocumentsQueryParams()])
      const doc = docs?.find(d => d.id === pdfId)
      if (doc) dbPut(STORES.LIBRARY, doc).catch(console.warn)
    },
  })
}

function deduplicateDocuments(docs: PdfDocument[]): PdfDocument[] {
  const seen = new Set<string>()
  return docs.filter(doc => {
    if (doc.id.startsWith('temp-')) return true
    if (seen.has(doc.id)) return false
    seen.add(doc.id)
    return true
  })
}

export const useUploadMutation = () => {
  const queryClient = useQueryClient()
  const libraryStore = useLibraryStore()
  return useMutation({
    mutationFn: (payload: File | { file: File; recentTaskId?: string }) =>
      libraryApi.upload(payload instanceof File ? payload : payload.file),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['documents'] })

      const file = payload instanceof File ? payload : payload.file
      const previousDocs = queryClient.getQueryData<PdfDocument[]>(['documents', normalizeDocumentsQueryParams()])
      const recentTaskId = payload instanceof File
        ? libraryStore.startRecentFileImport(file)
        : (payload.recentTaskId ?? libraryStore.startRecentFileImport(file))

      const optimisticDoc: PdfDocument = {
        id: `temp-${Date.now()}`,
        name: file.name,
        url: '',
        uploadedAt: new Date(),
        pageCount: 0,
        tags: [],
        authors: [],
      }

      queryClient.setQueryData(['documents', normalizeDocumentsQueryParams()], (old: PdfDocument[] | undefined) => [
        optimisticDoc,
        ...(old || []),
      ])

      return { previousDocs, optimisticId: optimisticDoc.id, recentTaskId }
    },
    onSuccess: (data, _file, context) => {
      if (context?.recentTaskId) {
        libraryStore.resolveRecentImport(context.recentTaskId)
      }
      queryClient.setQueryData(['documents', normalizeDocumentsQueryParams()], (old: PdfDocument[] | undefined) => {
        if (!old) return []
        const replaced = old.map(doc => {
          if (doc.id === context?.optimisticId) {
            const realDoc: PdfDocument = {
              id: data.pdfId || doc.id,
              name: data.filename || doc.name,
              url: '',
              uploadedAt: new Date(),
              pageCount: data.pageCount || 0,
              tags: [],
              authors: [],
            }
            dbPut(STORES.LIBRARY, realDoc).catch(console.warn)
            return realDoc
          }
          return doc
        })
        return deduplicateDocuments(replaced)
      })
      broadcastSync('RELOAD_LIBRARY')
    },
    onError: (err, _file, context) => {
      if (context?.recentTaskId) {
        libraryStore.markRecentImportFailed(
          context.recentTaskId,
          getImportErrorMessage(err, 'Upload failed'),
        )
      }
      if (context?.previousDocs) {
        queryClient.setQueryData(['documents', normalizeDocumentsQueryParams()], context.previousDocs)
      }
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      console.error('[Upload Mutation] Failed:', err)
    },
  })
}

export const useImportLinkMutation = () => {
  const libraryStore = useLibraryStore()
  return useMutation({
    mutationFn: (payload: string | { input: string; recentTaskId?: string }) =>
      libraryApi.importLink(typeof payload === 'string' ? payload : payload.input),
    onMutate: async (payload) => {
      const input = typeof payload === 'string' ? payload : payload.input
      const trimmed = input.trim()
      const recentTaskId = typeof payload === 'string'
        ? libraryStore.startRecentLinkImport(trimmed)
        : (payload.recentTaskId ?? libraryStore.startRecentLinkImport(trimmed))
      return { recentTaskId }
    },
    onError: (err, _input, context) => {
      if (context?.recentTaskId) {
        libraryStore.markRecentImportFailed(
          context.recentTaskId,
          getImportErrorMessage(err, 'Import failed'),
        )
      }
      console.error('[Import Link Mutation] Failed:', err)
    },
  })
}
