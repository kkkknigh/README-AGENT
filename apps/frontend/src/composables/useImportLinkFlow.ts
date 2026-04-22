import axios from 'axios'
import { useQueryClient } from '@tanstack/vue-query'
import type { ImportJobReadyEvent } from '../api'
import { useLibraryStore } from '../stores/library'
import { useImportLinkMutation } from './queries/useLibraryQueries'

function getErrorMessage(error: unknown, fallback: string) {
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

export function useImportLinkFlow() {
  const queryClient = useQueryClient()
  const libraryStore = useLibraryStore()
  const importLinkMutation = useImportLinkMutation()

  const startImportLink = async (
    input: string,
    options?: {
      recentTaskId?: string
      onReady?: (event: ImportJobReadyEvent) => Promise<void> | void
    },
  ) => {
    const trimmed = input.trim()
    if (!trimmed) {
      throw new Error('Import input is required')
    }

    const recentTaskId = options?.recentTaskId ?? libraryStore.startRecentLinkImport(trimmed)
    const response = await importLinkMutation.mutateAsync({ input: trimmed, recentTaskId })
    const readyEvent: ImportJobReadyEvent = {
      type: 'ready',
      jobId: response.importTaskId,
      status: response.status === 'completed' ? 'completed' : 'processing',
      input: response.input,
      pdfId: response.pdfId || '',
      taskId: response.taskId ?? null,
      filename: response.filename,
      pageCount: response.pageCount,
      documentStatus: response.documentStatus,
      isNewUpload: response.isNewUpload,
    }
    if (!readyEvent.pdfId) {
      throw new Error('Imported paper did not return a pdfId')
    }
    try {
      await options?.onReady?.(readyEvent)
      libraryStore.resolveRecentImport(recentTaskId)
      await queryClient.invalidateQueries({ queryKey: ['documents'] })
      return readyEvent
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to finalize imported paper')
      libraryStore.markRecentImportFailed(recentTaskId, message)
      throw (error instanceof Error ? error : new Error(message))
    }
  }

  return {
    startImportLink,
    isImportingLink: importLinkMutation.isPending,
  }
}
