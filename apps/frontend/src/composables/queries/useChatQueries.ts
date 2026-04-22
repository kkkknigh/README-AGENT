import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { chatSessionApi, type ChatMode, type ChatStreamEvent } from '../../api'
import type { ChatMessage } from '../../types'
import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { broadcastSync } from '../../utils/broadcast'
import { STORES, dbPut, dbPutMany, dbPutManyPreserving, dbDelete, dbDeleteMany, dbGetMany, dbGetAll } from '../../utils/db'

/**
 * 模块级缓存：暂存流式期间产生的 steps/thoughts。
 * 流式期间消息使用临时 pending ID，无法直接写入 IndexedDB（dbUpdate 找不到记录）。
 * 此 Map 按 sessionId 暂存，待 API refetch 返回真实 ID 后合并落库。
 *
 * 带 TTL 清理：超过 5 分钟未消费的条目自动丢弃，防止内存泄漏。
 */
const _pendingMeta = new Map<string, { steps?: ChatMessage['steps'], thoughts?: ChatMessage['thoughts'], _ts: number }>()
const _PENDING_META_TTL = 5 * 60 * 1000 // 5 minutes

function _purgeStalePendingMeta() {
    const now = Date.now()
    for (const [key, val] of _pendingMeta) {
        if (now - val._ts > _PENDING_META_TTL) _pendingMeta.delete(key)
    }
}

interface ChatKeys {
    all: readonly ['chat'];
    sessions: (context: unknown) => readonly ['chat', 'sessions', unknown];
    messages: (sessionId: string | Ref<string | null>) => readonly ['chat', 'messages', string | Ref<string | null>];
}

export const chatKeys: ChatKeys = {
    all: ['chat'] as const,
    sessions: (context) => ['chat', 'sessions', context] as const,
    messages: (sessionId) => ['chat', 'messages', sessionId] as const,
}

export type ChatSessionContext = {
    scope: 'global' | 'workspace' | 'document'
    workspaceId?: string | null
    documentRemoteId?: string | null
}

type SessionListItem = {
    id: string
    pdfId: string
    scope: 'global' | 'workspace' | 'document'
    workspaceId: string | null
    title: string
    createdAt: string
    updatedAt: string
    messageCount: number
}

function matchesSessionScope(session: Partial<SessionListItem>, context: ChatSessionContext) {
    if (session.scope !== context.scope) return false
    if (context.scope === 'workspace') return (session.workspaceId ?? null) === (context.workspaceId ?? null)
    if (context.scope === 'document') return (session.pdfId ?? '') === (context.documentRemoteId ?? '')
    return true
}

function normalizeSessionRecord(s: {
    id: string
    pdfId?: string
    scope: 'global' | 'workspace' | 'document'
    workspaceId?: string | null
    title: string
    createdAt: string
    updatedAt: string
    messageCount: number
}): SessionListItem {
    return {
        id: s.id,
        pdfId: s.pdfId || '',
        scope: s.scope,
        workspaceId: s.workspaceId ?? null,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messageCount,
    }
}

/**
 * 获取 PDF 相关的聊天会话列表
 */
export function useSessionsQuery(context: MaybeRefOrGetter<ChatSessionContext>) {
    const queryClient = useQueryClient()
    return useQuery({
        queryKey: computed(() => chatKeys.sessions(toValue(context))),
        queryFn: async () => {
            const resolved = toValue(context)
            if (!queryClient.getQueryData(chatKeys.sessions(resolved))) {
                const allCached = await dbGetAll(STORES.CHAT_SESSIONS).catch(() => [])
                const scopedSessions = allCached.filter((s: any) => matchesSessionScope(s, resolved))
                if (scopedSessions.length) return scopedSessions
            }
            const response = await chatSessionApi.listSessions(resolved)
            const sessions = response.sessions.map(normalizeSessionRecord)
            dbPutMany(STORES.CHAT_SESSIONS, sessions).catch(console.warn)
            return sessions
        },
    })
}

/**
 * 获取所有聊天会话（跨 PDF），用于聊天历史树形面板。
 * 优先从 IDB 预填充，避免与 useSessionsQuery 同时发起重复请求。
 */
export function useAllSessionsQuery() {
    const queryClient = useQueryClient()
    const qk = [...chatKeys.all, 'all-sessions'] as const
    return useQuery({
        queryKey: qk,
        queryFn: async () => {
            if (!queryClient.getQueryData(qk)) {
                const cached = await dbGetAll(STORES.CHAT_SESSIONS).catch(() => [])
                if (cached.length) return cached
            }
            const response = await chatSessionApi.listSessions(undefined, 200)
            const sessions = response.sessions.map(normalizeSessionRecord)
            dbPutMany(STORES.CHAT_SESSIONS, sessions).catch(console.warn)
            return sessions
        },
    })
}

/**
 * 获取指定会话的消息历史
 */
export function useMessagesQuery(sessionId: Ref<string | null | undefined>) {
    return useQuery({
        queryKey: chatKeys.messages(sessionId as any),
        queryFn: async () => {
            if (!sessionId.value || sessionId.value.startsWith('temp_')) return []
            const response = await chatSessionApi.getSessionMessages(sessionId.value)
            const messages: ChatMessage[] = response.messages.map(m => ({
                id: String(m.id),
                role: m.role as 'user' | 'assistant',
                content: m.content,
                timestamp: new Date(m.created_time),
                citations: m.citations || [],
                thoughts: (m as any).thoughts || [],
                steps: (m as any).steps || [],
                images: (m.attachments || [])
                    .filter((att: any) => att?.category === 'image')
                    .map((att: any) => {
                        const base64 = att?.data?.base64
                        if (!base64) return null
                        return String(base64).startsWith('data:')
                            ? String(base64)
                            : `data:image/png;base64,${String(base64)}`
                    })
                    .filter(Boolean) as string[]
            }))
            // 同步到 IndexedDB，保留本地缓存的 steps/thoughts（API 不返回这些字段）
            // 只读取当前消息集合的缓存记录（避免 dbGetAll 全量扫描）
            try {
                const messageIds = messages.map(m => m.id)
                const cached = await dbGetMany<ChatMessage>(STORES.CHAT_MESSAGES, messageIds)
                const metaMap = new Map<string, { steps?: ChatMessage['steps'], thoughts?: ChatMessage['thoughts'] }>()
                for (const c of cached) {
                    if (c.steps?.length || c.thoughts?.length) {
                        metaMap.set(String(c.id), { steps: c.steps, thoughts: c.thoughts })
                    }
                }
                if (metaMap.size > 0) {
                    for (const m of messages) {
                        const meta = metaMap.get(m.id)
                        if (meta) {
                            if (meta.steps) m.steps = meta.steps
                            if (meta.thoughts) m.thoughts = meta.thoughts
                        }
                    }
                }
            } catch { /* IndexedDB 不可用时静默降级 */ }
            // 从内存缓存恢复流式期间暂存的 steps/thoughts（pending ID → 真实 ID 迁移）
            const pendingMeta = _pendingMeta.get(sessionId.value!)
            if (pendingMeta) {
                // 找到最后一条 assistant 消息，将暂存的 steps/thoughts 挂载上去
                for (let i = messages.length - 1; i >= 0; i--) {
                    const msg = messages[i]
                    if (msg && msg.role === 'assistant') {
                        if (pendingMeta.steps) msg.steps = pendingMeta.steps
                        if (pendingMeta.thoughts) msg.thoughts = pendingMeta.thoughts
                        break
                    }
                }
                _pendingMeta.delete(sessionId.value!)
            }
            dbPutManyPreserving(STORES.CHAT_MESSAGES, messages, ['steps', 'thoughts']).catch(console.warn)
            return messages
        },
        enabled: computed(() => !!sessionId.value && !sessionId.value.startsWith('temp_')),
    })
}

/**
 * 创建新会话（乐观更新：立即在列表头部插入临时条目，失败时回滚）
 */
export function useCreateSessionMutation(context?: MaybeRefOrGetter<ChatSessionContext>) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: () => chatSessionApi.createSession(context ? toValue(context) : undefined),
        onMutate: async () => {
            const resolved = context ? toValue(context) : { scope: 'global' as const }
            const queryKey = chatKeys.sessions(resolved)
            await queryClient.cancelQueries({ queryKey })
            const previous = queryClient.getQueryData<SessionListItem[]>(queryKey)
            const tempId = `temp_${Date.now()}`
            const pdfId = { value: resolved.documentRemoteId ?? '' }
            queryClient.setQueryData<any[]>(queryKey, (old) => [
                { id: tempId, pdfId: pdfId.value, title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0 },
                ...(old || []),
            ])
            return { previous, queryKey, tempId }
        },
        onError: (_err, _vars, context) => {
            // 创建失败：回滚乐观插入
            if (context?.queryKey && context.previous !== undefined) {
                queryClient.setQueryData(context.queryKey, context.previous)
            }
        },
        onSuccess: (data, _vars, context) => {
            // 将临时条目替换为后端真实 ID
            if (context?.queryKey && context.tempId) {
                queryClient.setQueryData<any[]>(context.queryKey, (old) =>
                    old ? old.map(s => s.id === context.tempId ? { ...s, id: data.sessionId, title: data.title } : s) : old
                )
            }
            broadcastSync('RELOAD_SESSIONS', undefined)
        },
    })
}

/**
 * 删除会话（乐观更新：立即从列表移除，失败时回滚）
 */
export function useDeleteSessionMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (sessionId: string) => chatSessionApi.deleteSession(sessionId),
        onMutate: async (sessionId) => {
            await queryClient.cancelQueries({ queryKey: [...chatKeys.all, 'sessions'] })
            // 快照所有 sessions 缓存，用于回滚
            const queries = queryClient.getQueriesData<any[]>({ queryKey: [...chatKeys.all, 'sessions'] })
            // 乐观移除
            queryClient.setQueriesData<any[]>(
                { queryKey: [...chatKeys.all, 'sessions'] },
                (old) => (old ? old.filter(s => s.id !== sessionId) : old)
            )
            return { queries }
        },
        onError: (_err, _sessionId, context) => {
            // 删除失败：还原乐观移除
            if (context?.queries) {
                context.queries.forEach(([qk, qd]) => queryClient.setQueryData(qk, qd))
            }
            queryClient.invalidateQueries({ queryKey: [...chatKeys.all, 'sessions'] })
        },
        onSuccess: (_data, sessionId) => {
            queryClient.removeQueries({ queryKey: chatKeys.messages(sessionId) })
            dbDelete(STORES.CHAT_SESSIONS, sessionId).catch(console.warn)
            // 级联清理 IndexedDB 中该 session 的 proposals
            import('./useProposalQueries').then(({ clearProposalsForSession }) =>
                clearProposalsForSession(sessionId)
            ).catch(console.warn)
            broadcastSync('RELOAD_SESSIONS', undefined)
        },
    })
}

/**
 * 发送消息 Mutation
 */
export function useSendMessageMutation() {
    const queryClient = useQueryClient()
    const pendingIds = new Map<string, string>()
    const streamFinalized = new Map<string, boolean>()

    const markAssistantFailed = (queryKey: readonly unknown[], pendingAssistantId: string | undefined, errorText?: string) => {
        if (!pendingAssistantId) return
        queryClient.setQueryData<ChatMessage[]>(queryKey, (old) => {
            const current = old ? [...old] : []
            const index = current.findIndex((message) => message.id === pendingAssistantId)
            if (index === -1) {
                current.push({
                    id: pendingAssistantId,
                    role: 'assistant',
                    content: errorText || '消息发送失败，请稍后重试。',
                    timestamp: new Date(),
                    citations: []
                })
                return current
            }
            const target = current[index]
            if (!target) return current

            current[index] = {
                ...target,
                content: errorText || '消息发送失败，请稍后重试。',
                timestamp: new Date(),
            }
            return current
        })
    }

    return useMutation({
        mutationFn: async (params: {
            sessionId: string
            message: string
            pdfId: string
            mode?: ChatMode
            model?: string | null
            apiBase?: string | null
            apiKey?: string | null
            history?: Array<{ role: string; content: string }>
            pruneFromId?: string
            contextText?: string
            images?: string[]
            signal?: AbortSignal
        }) => {
            streamFinalized.set(params.sessionId, false)
            return chatSessionApi.sendMessage(
                params.sessionId,
                params.message,
                params.pdfId,
                params.mode,
                params.model,
                params.apiBase,
                params.apiKey,
                params.history,
                params.pruneFromId,
                params.contextText,
                params.images,
                (event) => {
                    // mutation 事件只刷新缓存，不影响聊天消息流
                    if (handleMutationEvent(queryClient, event)) return

                    // proposal 事件：Agent 创建审批请求，通过 SSE 推送，写入 query cache
                    if (event.type === 'proposal' && event.proposal) {
                        handleProposalEvent(queryClient, event.proposal)
                        return
                    }

                    // 后端返回真实 user_message_id，替换乐观 ID，保证 resend 的 pruneFromId 有效
                    if (event.type === 'user_message_ack' && event.userMessageId != null) {
                        const qk = chatKeys.messages(params.sessionId)
                        queryClient.setQueryData<ChatMessage[]>(qk, (old) => {
                            if (!old) return old
                            return old.map(m =>
                                m.role === 'user' && String(m.id).startsWith('optimistic-')
                                    ? { ...m, id: String(event.userMessageId) }
                                    : m
                            )
                        })
                        return
                    }

                    if (event.type === 'final') {
                        streamFinalized.set(params.sessionId, true)
                    }
                    if (event.type === 'error' && streamFinalized.get(params.sessionId)) {
                        return
                    }
                    handleStreamEvent(queryClient, params.sessionId, pendingIds.get(params.sessionId), event)
                },
                params.signal
            )
        },
        onMutate: async (variables) => {
            const queryKey = chatKeys.messages(variables.sessionId)
            await queryClient.cancelQueries({ queryKey })

            const previousMessages = queryClient.getQueryData<ChatMessage[]>(queryKey)
            const pendingAssistantId = `pending-${Date.now()}`
            pendingIds.set(variables.sessionId, pendingAssistantId)

            // 简单乐观更新：添加用户消息
            // 注意：如果存在 pruneFromId，说明需要裁减
            const newUserMsg: ChatMessage = {
                id: `optimistic-${Date.now()}`,
                role: 'user',
                content: variables.message,
                timestamp: new Date(),
                citations: [],
                images: variables.images?.map(b64 => `data:image/png;base64,${b64}`)
            }

            let nextMessages = previousMessages ? [...previousMessages] : []

            // 如果有裁减，先模拟裁减，同步清理 IndexedDB
            if (variables.pruneFromId) {
                const pruneIndex = nextMessages.findIndex(m => m.id === variables.pruneFromId)
                if (pruneIndex !== -1) {
                    const pruned = nextMessages.slice(pruneIndex)
                    nextMessages = nextMessages.slice(0, pruneIndex)
                    // 异步清理被裁消息的 IndexedDB 缓存（steps/thoughts）
                    const prunedIds = pruned.map(m => m.id)
                    dbDeleteMany(STORES.CHAT_MESSAGES, prunedIds).catch(console.warn)
                    // 后端已处理 proposals expire，前端同步清理 IndexedDB
                    import('./useProposalQueries').then(({ clearProposalsForSession }) =>
                        clearProposalsForSession(variables.sessionId)
                    ).catch(console.warn)
                }
            }

            queryClient.setQueryData<ChatMessage[]>(queryKey, [...nextMessages, newUserMsg])

            return { previousMessages, queryKey, pendingAssistantId }
        },
        onError: (err: any, variables: any, context: any) => {
            const pendingAssistantId = pendingIds.get(variables.sessionId) || context?.pendingAssistantId
            pendingIds.delete(variables.sessionId)
            streamFinalized.delete(variables.sessionId)

            // 用户主动取消（AbortError）时：保留用户消息（已持久化到 DB），仅移除 pending assistant
            const isAbort = err?.name === 'AbortError' || (err instanceof DOMException && err.name === 'AbortError')
            if (isAbort && context?.queryKey) {
                queryClient.setQueryData<ChatMessage[]>(context.queryKey, (old) => {
                    if (!old) return context.previousMessages
                    return old.filter(m => m.id !== pendingAssistantId)
                })
                // 清理 IndexedDB 中 pending assistant 的 partial 数据
                if (pendingAssistantId) {
                    dbDelete(STORES.CHAT_MESSAGES, pendingAssistantId).catch(console.warn)
                }
                // 同步真实 ID
                setTimeout(() => {
                    queryClient.invalidateQueries({ queryKey: chatKeys.messages(variables.sessionId) })
                }, 1000)
                return
            }

            // 其他错误：保留用户消息，标记 assistant 失败
            if (context?.queryKey) {
                markAssistantFailed(
                    context.queryKey,
                    pendingAssistantId,
                    err instanceof Error ? err.message : '消息发送失败，请稍后重试。'
                )
            }

            // 非取消错误：延迟同步 messages，确保乐观 ID 被替换为真实 ID
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: chatKeys.messages(variables.sessionId) })
            }, 1000)
        },
        onSuccess: (_data: any, variables) => {
            pendingIds.delete(variables.sessionId)
            streamFinalized.delete(variables.sessionId)

            // 只刷新会话列表（updatedAt 变了），不立刻刷新 messages。
            // 流式事件的 final 已经把完整回复写入缓存，立刻 invalidate 会触发
            // refetch，若后端尚未提交事务则拿到旧数据，导致消息消失。
            queryClient.invalidateQueries({ queryKey: [...chatKeys.all, 'sessions'] })

            // 延迟 2 秒后再与后端同步 messages，确保数据库已持久化
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: chatKeys.messages(variables.sessionId) })
                broadcastSync('RELOAD_MESSAGES', variables.sessionId)
            }, 2000)
        },
        onSettled: (_data, _error, variables) => {
            pendingIds.delete(variables.sessionId)
            streamFinalized.delete(variables.sessionId)
        }
    })
}

// ==================== Mutation 事件 → 缓存刷新 ====================

/** Agent 工具写操作成功后，后端推送 mutation 事件；前端按资源类型刷新对应缓存。 */
const MUTATION_INVALIDATION_MAP: Record<string, (detail: Record<string, any>, qc: ReturnType<typeof useQueryClient>) => void> = {
    notes: (detail, qc) => {
        qc.invalidateQueries({ queryKey: ['notes', detail.paper_id].filter(Boolean) })
        broadcastSync('RELOAD_NOTES', detail.paper_id)
    },
    kg_node: (_detail, qc) => {
        qc.invalidateQueries({ queryKey: ['roadmap'] })
    },
    kg_edge: (_detail, qc) => {
        qc.invalidateQueries({ queryKey: ['roadmap'] })
    },
    tag: (detail, qc) => {
        qc.invalidateQueries({ queryKey: ['paper-tags'] })
        if (detail.paper_id) {
            qc.invalidateQueries({ queryKey: ['paper-tags', detail.paper_id] })
        }
    },
    blog: (_detail, qc) => {
        qc.invalidateQueries({ queryKey: ['blog'] })
    },
    library: (_detail, qc) => {
        qc.invalidateQueries({ queryKey: ['documents'] })
        qc.invalidateQueries({ queryKey: ['documents-search'] })
        broadcastSync('RELOAD_LIBRARY')
    },
}

function handleMutationEvent(
    queryClient: ReturnType<typeof useQueryClient>,
    event: ChatStreamEvent
) {
    if (event.type !== 'mutation') return false
    const handler = MUTATION_INVALIDATION_MAP[event.resource]
    if (handler) {
        handler(event.detail || {}, queryClient)
    }
    return true
}

/**
 * 处理 SSE 推送的 proposal 事件：将新 proposal 写入 query cache，
 * 替代轮询 /api/proposals/pending。
 */
function handleProposalEvent(
    queryClient: ReturnType<typeof useQueryClient>,
    proposal: import('../../types').ProposalInfo
) {
    const qk = ['proposals', 'pending']
    queryClient.setQueryData<import('../../types').ProposalInfo[]>(qk, (old) => {
        const list = old ?? []
        // 去重：同一 proposal 不重复添加
        if (list.some(p => p.id === proposal.id)) return list
        return [...list, proposal]
    })
    // 持久化到 IndexedDB
    dbPut(STORES.PROPOSALS, proposal).catch(console.warn)
}

// 使用防抖或节流的副作用，降低 setQueryData 触发频率，提升性能
function handleStreamEvent(
    queryClient: ReturnType<typeof useQueryClient>,
    sessionId: string,
    pendingAssistantId: string | undefined,
    event: ChatStreamEvent
) {
    if (!pendingAssistantId) return

    const queryKey = chatKeys.messages(sessionId)
    
    // 由于 setQueryData 是同步且高频的，我们在实际渲染层可以依赖 Vue Query 自己的批量更新机制，
    // 但避免拼接字符串时产生不可控的大对象深拷贝：
    queryClient.setQueryData<ChatMessage[]>(queryKey, (old) => {
        const current = old ? [...old] : []
        const messageIndex = current.findIndex(message => message.id === pendingAssistantId)
        if (messageIndex === -1) {
            if (event.type === 'step') {
                current.push({
                    id: pendingAssistantId,
                    role: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    citations: [],
                    steps: [{ text: event.step || '', status: 'running' as const }],
                })
                return current
            }

            if (event.type === 'chunk') {
                current.push({
                    id: pendingAssistantId,
                    role: 'assistant',
                    content: event.delta || '',
                    timestamp: new Date(),
                    citations: []
                })
                return current
            }

            if (event.type === 'final') {
                current.push({
                    id: pendingAssistantId,
                    role: 'assistant',
                    content: event.response || '',
                    citations: event.citations || [],
                    timestamp: new Date(),
                })
                return current
            }

            if (event.type === 'error') {
                current.push({
                    id: pendingAssistantId,
                    role: 'assistant',
                    content: event.error || '消息流中断，请稍后重试。',
                    timestamp: new Date(),
                    citations: []
                })
                return current
            }

            if (event.type === 'thinking') {
                current.push({
                    id: pendingAssistantId,
                    role: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    citations: [],
                    thoughts: event.text ? [event.text] : []
                })
                return current
            }

            return current
        }

        const pendingMessage = current[messageIndex]
        if (!pendingMessage) return current

        if (event.type === 'tool_call') {
            const oldSteps = (pendingMessage.steps || []).map(s => ({ ...s, status: 'done' as const }))
            current[messageIndex] = {
                ...pendingMessage,
                steps: [...oldSteps, { text: `Using ${event.tool}`, status: 'running' as const }],
            }
            return current
        }

        if (event.type === 'tool_result') {
            const oldSteps = (pendingMessage.steps || []).map(s => ({ ...s, status: 'done' as const }))
            current[messageIndex] = {
                ...pendingMessage,
                steps: [...oldSteps, { text: event.summary || `Completed ${event.tool}`, status: 'done' as const }],
            }
            return current
        }

        if (event.type === 'step') {
            const oldSteps = (pendingMessage.steps || []).map(s => ({ ...s, status: 'done' as const }))
            current[messageIndex] = {
                ...pendingMessage,
                steps: [...oldSteps, { text: event.step || '', status: 'running' as const }],
            }
            return current
        }

        if (event.type === 'chunk') {
            // Check if the current content is a loading step or placeholder to clear it before appending
            const placeholders = ['正在生', '正在调', '调用 Agent', 'Generating', '搜索文献', '解析', '总结中', '思考中', '正在']
            let currentContent = pendingMessage.content || ''
            if (currentContent && placeholders.some(p => currentContent.includes(p)) && currentContent.length < 30) {
                currentContent = ''
            }
            
            current[messageIndex] = {
                ...pendingMessage,
                content: `${currentContent}${event.delta || ''}`,
            }
            return current
        }

        if (event.type === 'final') {
            const finalSteps = (pendingMessage.steps || []).map(s => ({ ...s, status: 'done' as const }))
            const finalThoughts = pendingMessage.thoughts
            current[messageIndex] = {
                ...pendingMessage,
                content: event.response || pendingMessage.content,
                citations: event.citations || [],
                steps: finalSteps,
                timestamp: new Date(),
            }
            // 暂存 steps/thoughts 到内存缓存，待 refetch 返回真实 ID 后落库。
            // 注意：此时消息 ID 是临时的 pending-xxx，直接 dbUpdate 会因记录不存在而静默失败。
            if (finalSteps?.length || finalThoughts?.length) {
                _purgeStalePendingMeta()
                _pendingMeta.set(sessionId, {
                    steps: finalSteps,
                    thoughts: finalThoughts,
                    _ts: Date.now(),
                })
            }
            return current
        }

        if (event.type === 'error') {
            // 如果已经累积了有效内容，保留已有内容而非用错误信息覆盖
            const hasRealContent = pendingMessage.content
                && pendingMessage.content.length > 30
                && !['正在生', '正在调', '调用 Agent', '搜索文献', '思考中', '正在'].some(p => pendingMessage.content.startsWith(p))
            current[messageIndex] = {
                ...pendingMessage,
                content: hasRealContent
                    ? pendingMessage.content
                    : (event.error || '消息流中断，请稍后重试。'),
                timestamp: new Date(),
            }
            return current
        }

        if (event.type === 'thinking' && event.text) {
            current[messageIndex] = {
                ...pendingMessage,
                thoughts: [...(pendingMessage.thoughts || []), event.text],
            }
            return current
        }

        return current
    })
}
