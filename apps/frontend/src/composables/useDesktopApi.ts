import { ref } from "vue"
import type {
  LocalChatMessageDto,
  LocalChatThreadDto,
  WorkbenchTabDto,
  WorkspaceDetailDto,
  WorkspaceNodeDto,
} from "@readmeclaw/shared-ui"

const API_BASE =
  __READMECLAW_LOCAL_RUNTIME_URL__ ??
  "http://127.0.0.1:4242"

export function useDesktopApi() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    loading.value = true
    error.value = null
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        ...init,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      if (response.status === 204) {
        return undefined as T
      }

      return (await response.json()) as T
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    getRemoteSettings: () => request<{ baseUrl: string; accessToken: string | null; updatedAt: string | null }>("/settings/remote"),
    saveRemoteSettings: (payload: { baseUrl: string; accessToken?: string | null }) =>
      request<{ baseUrl: string; accessToken: string | null; updatedAt: string | null }>("/settings/remote", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    bootstrapSync: () => request<{ state: string; documentCount: number; noteCount: number; graphProjectCount: number; implemented?: boolean; message?: string }>("/sync/bootstrap", { method: "POST" }),
    listWorkspaces: () => request<{ items: WorkspaceNodeDto[] }>("/workspaces/tree"),
    createWorkspace: (payload: { name: string; parentId?: string | null; color?: string | null; description?: string | null }) =>
      request<WorkspaceNodeDto>("/workspaces", { method: "POST", body: JSON.stringify(payload) }),
    getWorkspaceDetail: (workspaceId: string) => request<WorkspaceDetailDto>(`/workspaces/${workspaceId}`),
    bindDocument: (workspaceId: string, documentId: string) =>
      request(`/workspaces/${workspaceId}/documents/${documentId}/bind`, { method: "POST" }),
    listTabs: () => request<{ items: WorkbenchTabDto[] }>("/tabs"),
    saveTabs: (items: Array<{
      id?: string
      type: WorkbenchTabDto["type"]
      resourceRemoteId?: string | null
      title: string
      payloadJson: string
    }>) => request<{ items: WorkbenchTabDto[] }>("/tabs", {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
    updateTabState: (tabId: string, payload: Partial<{
      title: string
      resourceRemoteId: string | null
      payloadJson: string
    }>) => request<WorkbenchTabDto>(`/tabs/${tabId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
    closeTab: (tabId: string) => request<void>(`/tabs/${tabId}`, { method: "DELETE" }),
    listThreads: () => request<{ items: LocalChatThreadDto[] }>("/threads"),
    createThread: (payload: { title: string; scope: "global" | "workspace" | "document"; workspaceId?: string | null; documentRemoteId?: string | null }) =>
      request<LocalChatThreadDto>("/threads", { method: "POST", body: JSON.stringify(payload) }),
    listMessages: (threadId: string) => request<{ items: LocalChatMessageDto[] }>(`/threads/${threadId}/messages`),
    sendMessage: async (threadId: string, message: string) => {
      const response = await fetch(`${API_BASE}/threads/${threadId}/runs/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, mode: "agent" }),
      })

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let finalResponse = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split("\n\n")
        buffer = chunks.pop() ?? ""
        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue
          const data = chunk.slice(6).trim()
          if (data === "[DONE]") continue
          const parsed = JSON.parse(data) as { type: string; delta?: string; response?: string }
          if (parsed.type === "chunk" && parsed.delta) {
            finalResponse += parsed.delta
          }
          if (parsed.type === "final" && parsed.response) {
            finalResponse = parsed.response
          }
        }
      }

      return finalResponse
    },
  }
}
