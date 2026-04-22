import { openStreamResponse } from './core'
import type { ImportJobEvent } from './index'

type ImportJobStreamHandlers = {
  onOpen?: () => void
  onMessage: (event: ImportJobEvent) => void
  onError?: (error: unknown) => void
  onClose?: () => void
  heartbeatTimeoutMs?: number
}

export type ImportJobStreamConnection = {
  close: () => void
}

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000

function parseSseBlock(block: string): ImportJobEvent | null {
  const dataLines = block
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())

  if (!dataLines.length) return null

  const raw = dataLines.join('\n').trim()
  if (!raw || raw === '[DONE]') return null

  return JSON.parse(raw) as ImportJobEvent
}

export function openImportJobStream(importTaskId: string, handlers: ImportJobStreamHandlers): ImportJobStreamConnection {
  const controller = new AbortController()
  const heartbeatTimeoutMs = handlers.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS
  let closed = false
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null

  const clearHeartbeatTimer = () => {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  const resetHeartbeatTimer = () => {
    clearHeartbeatTimer()
    heartbeatTimer = setTimeout(() => {
      if (closed) return
      handlers.onError?.(new Error(`Import stream heartbeat timeout for ${importTaskId}`))
      controller.abort()
    }, heartbeatTimeoutMs)
  }

  const run = async () => {
    try {
      const response = await openStreamResponse(`/imports/link/${importTaskId}/stream`, {}, true, controller.signal)
      if (!response.ok) {
        throw new Error(`Import stream request failed: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('Import stream response body is empty')
      }

      handlers.onOpen?.()
      resetHeartbeatTimer()

      const decoder = new TextDecoder()
      let buffer = ''

      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split(/\r?\n\r?\n/)
        buffer = parts.pop() || ''

        for (const part of parts) {
          const event = parseSseBlock(part)
          if (!event) continue
          resetHeartbeatTimer()
          handlers.onMessage(event)
        }
      }
    } catch (error) {
      if (!closed && !controller.signal.aborted) {
        handlers.onError?.(error)
      }
    } finally {
      clearHeartbeatTimer()
      if (!closed) {
        closed = true
        handlers.onClose?.()
      }
    }
  }

  void run()

  return {
    close() {
      if (closed) return
      closed = true
      clearHeartbeatTimer()
      controller.abort()
      handlers.onClose?.()
    },
  }
}
