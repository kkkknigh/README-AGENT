<script setup lang="ts">
// ------------------------- 导入依赖与 store -------------------------
import { ref, computed, onBeforeUnmount, onMounted, nextTick, toRef } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useChatStore } from '../../stores/chat'
import { usePanelStore } from '../../stores/panel'
import { useLibraryStore } from '../../stores/library'
import { usePdfStore } from '../../stores/pdf'
import { useProfileStore } from '../../stores/profile'
import { pdfApi, chatSessionApi, proposalApi } from '../../api'
import type { ChatMode } from '../../api'
import type { ChatMessage } from '../../types'
import type { WorkbenchContextDto } from '@readmeclaw/shared-ui'
import CustomModelModal from './CustomModelModal.vue'
import ChatHistorySidebar from './ChatHistorySidebar.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatInputArea from './ChatInputArea.vue'

// 导入 Vue Query Hooks
import {
  useSessionsQuery,
  useAllSessionsQuery,
  useMessagesQuery,
  useSendMessageMutation,
  useCreateSessionMutation,
  useDeleteSessionMutation,
  chatKeys
} from '../../composables/queries/useChatQueries'
import { useDocumentsQuery } from '../../composables/queries/useLibraryQueries'
import { usePendingProposals, useProposalAction } from '../../composables/queries/useProposalQueries'

// 初始化各个 store 实例
const props = withDefaults(defineProps<Partial<WorkbenchContextDto>>(), {
  scope: 'global',
  workspaceId: null,
  documentRemoteId: null,
  activeResourceType: null,
  currentReadingDocumentId: null,
  activeTabId: null,
  activeTabTitle: null,
  openTabs: () => [],
})

const chatStore = useChatStore()
const panelStore = usePanelStore()
const libraryStore = useLibraryStore()
const pdfStore = usePdfStore()
const profileStore = useProfileStore()
const queryClient = useQueryClient()

// Feature: Custom Models & Model State
const showCustomModelModal = ref(false)
const selectedModel = ref('README Fusion')
const messageListRef = ref<InstanceType<typeof ChatMessageList> | null>(null)

// --- Feature: Chat Mode Toggle ---
const chatMode = computed<ChatMode>({
  get: () => chatStore.chatMode,
  set: (mode) => chatStore.setChatMode(mode)
})

// 自定义模型列表 — 统一从 profileStore 读取
const customModels = computed(() => profileStore.llmKeys)

// Chat session state
const showHistoryPanel = ref(false)
const sessionError = ref('')

// ------------------------- Vue Query -------------------------
const currentPdfId = computed(() => props.currentReadingDocumentId ?? props.documentRemoteId ?? libraryStore.currentDocumentId)
const currentSessionContext = computed(() => ({
  scope: 'global' as const,
  workspaceId: props.workspaceId ?? null,
  documentRemoteId: currentPdfId.value ?? null,
}))
const attachedContext = computed<WorkbenchContextDto>(() => ({
  scope: props.scope ?? 'global',
  workspaceId: props.workspaceId ?? null,
  documentRemoteId: props.documentRemoteId ?? null,
  currentReadingDocumentId: props.currentReadingDocumentId ?? currentPdfId.value ?? null,
  activeResourceType: props.activeResourceType ?? null,
  activeTabId: props.activeTabId ?? null,
  activeTabTitle: props.activeTabTitle ?? null,
  openTabs: props.openTabs ?? [],
}))
const currentSessionId = toRef(chatStore, 'currentSessionId')

const { data: sessions, refetch: refetchSessions } = useSessionsQuery(currentSessionContext)
const { data: allSessions } = useAllSessionsQuery()
const { data: allDocuments } = useDocumentsQuery()
const { data: messages, isLoading: isMessagesLoading } = useMessagesQuery(currentSessionId)

const sendMessageMutation = useSendMessageMutation()
const createSessionMutation = useCreateSessionMutation(currentSessionContext)
const deleteSessionMutation = useDeleteSessionMutation()

// Proposal: SSE 推送驱动，仅挂载时 fetch 一次兜底
const { data: pendingProposals } = usePendingProposals()
const proposalAction = useProposalAction()

// 只显示当前 session 的 pending proposals
const currentProposals = computed(() =>
  (pendingProposals.value || []).filter(p => p.session_id === chatStore.currentSessionId)
)

const handleProposalApprove = (id: string) => {
  proposalAction.mutate({ id, action: 'approve' })
}
const handleProposalReject = (id: string) => {
  proposalAction.mutate({ id, action: 'reject' })
}

// 只有在发送中或者初次加载（且无历史记录）时才显示加载状态
const isLoadingChat = computed(() => 
  sendMessageMutation.isPending.value || 
  (isMessagesLoading.value && (!messages.value || messages.value.length === 0))
)

// ---- Stop / Queue 机制 ----
const currentAbortController = ref<AbortController | null>(null)
const queuedMessage = ref<{ text: string; mode: ChatMode; model: string; images?: string[]; contextText?: string } | null>(null)
const hasQueuedMessage = computed(() => !!queuedMessage.value)

type OverlayExplainEventDetail = {
  pdfId: string | null
  overlayId: string
  page: number
  kind: 'image' | 'table' | 'formula'
  imageDataUrl?: string
  bboxNorm: {
    left: number
    top: number
    width: number
    height: number
  }
}

// ------------------------- Lifecycle -------------------------
onMounted(() => {
  // 清理旧版 PIN 加密存储（已迁移到 localStorage 明文）
  localStorage.removeItem('readme_custom_models_encrypted')
  sessionStorage.removeItem('readme_custom_models_session')

  window.addEventListener('pdf-overlay-explain', handleOverlayExplainEvent)
})

onBeforeUnmount(() => {
  window.removeEventListener('pdf-overlay-explain', handleOverlayExplainEvent)
})

// ------------------------- Handlers -------------------------

const handleCustomModelSave = (modelInfo: { name: string; apiBase: string; apiKey: string }) => {
  const model = profileStore.addLlmKey(modelInfo)
  showCustomModelModal.value = false
  selectedModel.value = model.name
}

const toggleHistoryPanel = () => {
  showHistoryPanel.value = !showHistoryPanel.value
}

const createNewChat = () => {
  // 仅本地清空，不调用后端。首条消息发送时 executeSendMessage 会自动懒创建会话。
  chatStore.currentSessionId = null
  showHistoryPanel.value = false
}


const deleteChatSession = (sessionId: string, event: Event) => {
  event.stopPropagation()
  if (!confirm('确定要删除这个对话吗？')) return

  // 立即切换当前会话，不等后端响应
  const wasCurrentSession = chatStore.currentSessionId === sessionId
  if (wasCurrentSession) {
    const remaining = currentScopedSessions.value.filter(s => s.id !== sessionId)
    chatStore.currentSessionId = remaining.length > 0 ? remaining[0]!.id : null
  }

  deleteSessionMutation.mutate(sessionId, {
    onError: () => {
      // 删除失败：还原切换并提示错误
      if (wasCurrentSession) {
        chatStore.currentSessionId = sessionId
      }
      sessionError.value = '删除对话失败，请重试'
      setTimeout(() => { sessionError.value = '' }, 3000)
    }
  })
}

// 重命名会话标题
const renameChatSession = async (sessionId: string, newTitle: string) => {
  try {
    const { chatSessionApi } = await import('../../api')
    await chatSessionApi.updateSessionTitle(sessionId, newTitle)
    // 刷新会话列表以显示新标题
    await refetchSessions()
  } catch {
    sessionError.value = '重命名失败，请重试'
    setTimeout(() => { sessionError.value = '' }, 3000)
  }
}

// 跨论文加载会话：切换 PDF 并加载指定会话
const loadCrossSession = async (sessionId: string, pdfId: string) => {
  // 如果是不同的 PDF，先切换过去
  if (pdfId && pdfId !== libraryStore.currentDocumentId) {
    const doc = allDocuments.value?.find(d => d.id === pdfId)
    if (doc) {
      await libraryStore.selectDocument(pdfId)
    }
  }
  chatStore.currentSessionId = sessionId
  showHistoryPanel.value = false
}

// 获取当前 PDF 的会话列表
const currentScopedSessions = computed(() => sessions.value || [])

const handleModelChange = (model: string) => {
  selectedModel.value = model
}

const handleDeleteModel = (id: string) => {
  const index = profileStore.llmKeys.findIndex(m => m.id === id)
  if (index === -1) return
  const modelToDelete = profileStore.llmKeys[index]
  profileStore.removeLlmKey(index)

  if (modelToDelete && selectedModel.value === modelToDelete.name) {
    selectedModel.value = 'README Fusion'
  }
}

const handleToggleMode = () => {
  chatStore.toggleChatMode()
}

// --- Resend Logic ---
const handleResend = async (index: number) => {
  const msgList = messages.value || []
  const message = msgList[index]
  if (!message || isLoadingChat.value) return
  
  let targetContent = message.content
  let historyIndex = index
  
  if (message.role === 'assistant' && index > 0) {
    const prevMsg = msgList[index - 1]
    if (prevMsg && prevMsg.role === 'user') {
      targetContent = prevMsg.content
      historyIndex = index - 1
    }
  }

  const history = msgList.slice(0, historyIndex).map(m => ({
    role: m.role,
    content: m.content
  }))

  await executeSendMessage(targetContent, history, { resendFromId: message.id })
}

const handleResendEdited = async (index: number, newContent: string) => {
  if (isLoadingChat.value) return
  const msgList = messages.value || []
  const originalMsg = msgList[index]

  const history = msgList.slice(0, index).map(m => ({
    role: m.role,
    content: m.content
  }))

  await executeSendMessage(newContent, history, { resendFromId: originalMsg?.id, edited: true })
}

const executeSendMessage = async (
  content: string,
  historyOverride?: { role: string; content: string }[],
  meta?: { resendFromId?: string; edited?: boolean },
  images?: string[],
  contextText?: string
) => {
  if (!content && (!images || images.length === 0)) return

  let model: string | null = null
  let apiBase: string | null = null
  let apiKey: string | null = null

  if (selectedModel.value !== 'README Fusion') {
    model = selectedModel.value
    const matchedModel = profileStore.llmKeys.find(m => m.name === selectedModel.value)
    if (matchedModel) {
      apiBase = matchedModel.apiBase
      apiKey = matchedModel.apiKey
    }
  }

  // 创建 AbortController 用于取消
  const abortController = new AbortController()
  currentAbortController.value = abortController

  try {
    // 确保存在 sessionId，如果不存在则自动创建
    let sessionId = chatStore.currentSessionId
    if (!sessionId || sessionId.startsWith('temp_')) {
      const resp = await createSessionMutation.mutateAsync()
      sessionId = resp.sessionId
      // 先预填充消息缓存为空数组，防止 useMessagesQuery 启用后自动 fetch
      // 返回空数据覆盖掉 onMutate 的乐观更新
      queryClient.setQueryData(chatKeys.messages(sessionId), [])
      chatStore.currentSessionId = sessionId
    }

    await sendMessageMutation.mutateAsync({
      sessionId,
      message: content || '请分析这张图片',
      pdfId: currentPdfId.value ?? '',
      mode: chatMode.value,
      model,
      apiBase,
      apiKey,
      history: historyOverride,
      pruneFromId: meta?.resendFromId,
      contextText,
      images,
      attachedContext: attachedContext.value,
      signal: abortController.signal
    })

    if (contextText) {
      pdfStore.clearSelection()
    }

    nextTick(() => {
      messageListRef.value?.scrollToBottom()
    })
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError' || (err instanceof DOMException && err.name === 'AbortError')
    if (!isAbort) {
      console.error('发送消息失败:', err)
    }
  } finally {
    currentAbortController.value = null
    // 自动处理排队消息
    processQueue()
  }
}

// 停止当前生成：自动 reject 所有 pending proposals，然后取消请求并通知后端中止 Agent
const stopGeneration = () => {
  // 直接调用 API 批量 reject，避免多次 mutate 互相覆盖乐观更新
  const pending = (pendingProposals.value || []).filter(p => p.status === 'pending')
  if (pending.length > 0) {
    Promise.allSettled(
      pending.map(p => proposalApi.action(p.id, 'reject', '用户中止了对话'))
    ).then(() => {
      queryClient.invalidateQueries({ queryKey: ['proposals', 'pending'] })
    })
  }

  if (currentAbortController.value) {
    currentAbortController.value.abort()
    currentAbortController.value = null
  }
  // 通知后端中止正在运行的 Agent（fire-and-forget）
  const sessionId = currentSessionId.value
  if (sessionId) {
    chatSessionApi.abortAgent(sessionId).catch(() => {})
  }
}

// 排队一条消息：等当前对话结束后自动发送
const enqueueMessage = (payload: { text: string; mode: ChatMode; model: string; images?: string[]; contextText?: string }) => {
  queuedMessage.value = payload
  if (payload.contextText) {
    pdfStore.clearSelection()
  }
}

// 处理排队消息
const processQueue = () => {
  if (queuedMessage.value) {
    const queued = queuedMessage.value
    queuedMessage.value = null
    nextTick(() => {
      selectedModel.value = queued.model
      chatMode.value = queued.mode
      executeSendMessage(queued.text, undefined, undefined, queued.images, queued.contextText)
    })
  }
}

// --- Selection Logic ---
const handleToggleSelectionMode = () => {
  panelStore.toggleSelectionMode()
}

const handleToggleMessageSelection = (id: string) => {
  panelStore.toggleMessageSelection(id)
}

const handleCopySelected = () => {
  const msgList = messages.value || []
  const selected = msgList.filter(m => panelStore.selectedMessageIds.has(m.id))
  const list = selected.map(m => ({
    role: m.role === 'user' ? '用户' : 'AI',
    content: m.content,
    timestamp: m.timestamp
  }))
  const json = JSON.stringify(list, null, 2)

  if (json && json !== '[]') {
    navigator.clipboard.writeText(json)
    panelStore.selectionMode = false
    panelStore.selectedMessageIds.clear()
  }
}

const handleChatSend = async (payload: { text: string; mode: ChatMode; model: string; images?: string[]; contextText?: string }) => {
  selectedModel.value = payload.model
  chatMode.value = payload.mode
  await executeSendMessage(payload.text, undefined, undefined, payload.images, payload.contextText)
}

const handleOverlayExplainEvent = async (event: Event) => {
  const detail = (event as CustomEvent<OverlayExplainEventDetail>).detail
  if (!detail?.pdfId) return
  if (detail.pdfId && currentPdfId.value && detail.pdfId !== currentPdfId.value) return

  let sessionId = chatStore.currentSessionId
  if (!sessionId || sessionId.startsWith('temp_')) {
    const resp = await createSessionMutation.mutateAsync()
    sessionId = resp.sessionId
    queryClient.setQueryData(chatKeys.messages(sessionId), [])
    chatStore.currentSessionId = sessionId
  }

  const queryKey = chatKeys.messages(sessionId)
  const userText = `Explain the selected ${detail.kind} on page ${detail.page}.`
  const pendingAssistantId = `overlay-pending-${Date.now()}`

  queryClient.setQueryData(queryKey, (old: ChatMessage[] | undefined) => {
    const current = old ? [...old] : []
    return [
      ...current,
      {
        id: `overlay-user-${Date.now()}`,
        role: 'user',
        content: userText,
        timestamp: new Date(),
        citations: [],
      },
      {
        id: pendingAssistantId,
        role: 'assistant',
        content: 'Analyzing selected region...',
        timestamp: new Date(),
        citations: [],
      },
    ]
  })

  try {
    await pdfApi.explainOverlay(detail.pdfId, {
      overlayId: detail.overlayId,
      sessionId,
      page: detail.page,
      kind: detail.kind,
      bboxNorm: detail.bboxNorm,
      imageDataUrl: detail.imageDataUrl ?? '',
    })
    await queryClient.invalidateQueries({ queryKey })
    queryClient.invalidateQueries({ queryKey: [...chatKeys.all, 'sessions'] })
  } catch (error) {
    console.error('Failed to explain overlay:', error)
    queryClient.setQueryData(queryKey, (old: ChatMessage[] | undefined) => {
      const current = old ? [...old] : []
      return current.map((message) =>
        message.id === pendingAssistantId
          ? {
              id: `overlay-ai-error-${Date.now()}`,
              role: 'assistant',
              content: 'Overlay explanation failed. Please try again.',
              timestamp: new Date(),
              citations: [],
            }
          : message
      )
    })
  }

  nextTick(() => {
    messageListRef.value?.scrollToBottom()
  })
}

// 监听当前文档 ID 变化
defineExpose({
  toggleHistoryPanel,
  createNewChat,
  isHistoryPanelOpen: showHistoryPanel
})
</script>

<template>
  <div class="h-full flex flex-col relative bg-transparent">
    <!-- Session Error Toast -->
    <div
      v-if="sessionError"
      class="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-500/90 text-white text-xs rounded-lg shadow-lg whitespace-nowrap pointer-events-none transition-opacity duration-300"
    >
      {{ sessionError }}
    </div>

    <!-- Custom Model Modal -->
    <CustomModelModal
      v-if="showCustomModelModal"
      @save="handleCustomModelSave"
      @close="showCustomModelModal = false"
    />

    <!-- History Panel (Overlay) -->
    <ChatHistorySidebar
      v-if="showHistoryPanel"
      :sessions="currentScopedSessions"
      :allSessions="allSessions || []"
      :documents="allDocuments || []"
      :currentSessionId="chatStore.currentSessionId"
      :currentPdfId="currentPdfId"
      @close="showHistoryPanel = false"
      @delete-session="deleteChatSession"
      @rename-session="renameChatSession"
      @load-cross-session="loadCrossSession"
    />

    <div class="flex-1 flex flex-col relative w-full h-full overflow-hidden">
        <ChatMessageList
          ref="messageListRef"
          :messages="messages || []"
          :isLoadingContent="isLoadingChat"
          :selectionMode="panelStore.selectionMode"
          :selectedIds="panelStore.selectedMessageIds"
          :proposals="currentProposals"
          @resend="handleResend"
          @resend-edited="handleResendEdited"
          @toggle-selection="handleToggleMessageSelection"
          @proposal-approve="handleProposalApprove"
          @proposal-reject="handleProposalReject"
        />

        <!-- Selection Mode Toolbar (Floating) -->
        <div 
          v-if="panelStore.selectionMode" 
          class="selection-float-toolbar absolute bottom-24 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg flex items-center gap-2 min-w-max transition-all duration-300"
        >
          <span class="selection-float-toolbar__label text-xs whitespace-nowrap">
            已选择 {{ panelStore.selectedMessageIds.size }} 条
          </span>
          <div class="selection-float-toolbar__divider h-3 w-[1px]"></div>
          <div class="flex gap-1 items-center">
            <button 
              @click="panelStore.selectionMode = false; panelStore.selectedMessageIds.clear()"
              class="ui-btn ui-btn--compact selection-float-toolbar__btn interactive-3d whitespace-nowrap"
            >取消</button>
            <button 
              @click="handleCopySelected"
              :disabled="panelStore.selectedMessageIds.size === 0"
              class="ui-btn ui-btn--compact selection-float-toolbar__btn selection-float-toolbar__btn--active interactive-3d whitespace-nowrap"
            >复制为 JSON</button>
          </div>
        </div>

        <ChatInputArea
          :isLoadingContent="isLoadingChat"
          :chatMode="chatMode"
          :customModels="customModels"
          :selectedModel="selectedModel"
          :selectedText="pdfStore.selectedText"
          :selectionMode="panelStore.selectionMode"
          :hasQueuedMessage="hasQueuedMessage"
          @clear-selection="pdfStore.clearSelection()"
          @send="handleChatSend"
          @stop="stopGeneration"
          @enqueue="enqueueMessage"
          @change-model="handleModelChange"
          @open-model-modal="showCustomModelModal = true"
          @delete-model="handleDeleteModel"
          @toggle-mode="handleToggleMode"
          @toggle-selection-mode="handleToggleSelectionMode"
        />
    </div>
  </div>
</template>

<style scoped>
.selection-float-toolbar {
  background: var(--c-bg-elevated);
  border: var(--border-width) solid var(--c-border-light);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(12px);
}

.selection-float-toolbar__label {
  color: var(--c-text-secondary);
}

.selection-float-toolbar__divider {
  background: var(--c-border-light);
}

.selection-float-toolbar__btn {
  color: var(--c-btn-text);
}

.selection-float-toolbar__btn--active {
  color: var(--c-accent);
}
</style>
