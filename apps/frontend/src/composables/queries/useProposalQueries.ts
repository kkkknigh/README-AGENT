import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { proposalApi } from '../../api'
import type { ProposalInfo } from '../../types'
import { STORES, dbPutMany, dbGetAll, dbUpdate, dbDeleteMany } from '../../utils/db'

export const proposalKeys = {
    pending: ['proposals', 'pending'] as const,
}

/**
 * Pending proposals 查询
 *
 * 数据来源优先级：SSE 推送 > IndexedDB 缓存 > API 兜底
 * 页面刷新后先从 IndexedDB 恢复 pending proposals，再用 API 同步。
 */
export function usePendingProposals() {
    const queryClient = useQueryClient()
    return useQuery({
        queryKey: proposalKeys.pending,
        queryFn: async () => {
            if (!queryClient.getQueryData(proposalKeys.pending)) {
                const cached = await dbGetAll<ProposalInfo>(STORES.PROPOSALS).catch(() => [])
                const pendingCached = cached.filter(p => p.status === 'pending')
                if (pendingCached.length) return pendingCached
            }
            const { proposals } = await proposalApi.getPending()
            _syncProposalsToIdb(proposals).catch(console.warn)
            return proposals
        },
        staleTime: 5 * 60 * 1000,
    })
}

/**
 * 恢复 IndexedDB 中的 pending proposals 到 query cache（组件挂载时调用）
 */
export async function restoreProposalsFromIdb(
    queryClient: ReturnType<typeof useQueryClient>
) {
    try {
        const cached = await dbGetAll<ProposalInfo>(STORES.PROPOSALS)
        const pending = cached.filter(p => p.status === 'pending')
        if (pending.length > 0) {
            queryClient.setQueryData<ProposalInfo[]>(proposalKeys.pending, (old) => {
                const existing = old ?? []
                const existingIds = new Set(existing.map(p => p.id))
                const newOnes = pending.filter(p => !existingIds.has(p.id))
                return newOnes.length > 0 ? [...existing, ...newOnes] : existing
            })
        }
    } catch { /* IndexedDB 不可用时静默降级 */ }
}

/**
 * Proposal 审批操作（approve / reject）
 */
export function useProposalAction() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ id, action, comment }: {
            id: string
            action: 'approve' | 'reject'
            comment?: string
        }) => {
            return proposalApi.action(id, action, comment)
        },
        onMutate: async ({ id, action }) => {
            await queryClient.cancelQueries({ queryKey: proposalKeys.pending })
            const previous = queryClient.getQueryData<ProposalInfo[]>(proposalKeys.pending)
            const newStatus = action === 'approve' ? 'approved' as const : 'rejected' as const
            queryClient.setQueryData<ProposalInfo[]>(proposalKeys.pending, (old) =>
                (old ?? []).map(p => p.id === id ? { ...p, status: newStatus } : p)
            )
            // 同步到 IndexedDB
            dbUpdate<ProposalInfo>(STORES.PROPOSALS, id, { status: newStatus }).catch(console.warn)
            return { previous }
        },
        onError: (_err, _vars, context) => {
            if (context?.previous) {
                queryClient.setQueryData(proposalKeys.pending, context.previous)
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: proposalKeys.pending })
            // Proposal 执行可能修改 tags/notes 等，需刷新文献库数据
            queryClient.invalidateQueries({ queryKey: ['documents'] })
            queryClient.invalidateQueries({ queryKey: ['documents-search'] })
        },
    })
}

/**
 * 清理 IndexedDB 中指定 session 的 proposals（删除 session / resend 时调用）
 */
export async function clearProposalsForSession(sessionId: string) {
    try {
        const all = await dbGetAll<ProposalInfo>(STORES.PROPOSALS)
        const toDelete = all.filter(p => p.session_id === sessionId).map(p => p.id)
        if (toDelete.length > 0) {
            await dbDeleteMany(STORES.PROPOSALS, toDelete)
        }
    } catch { /* 静默降级 */ }
}

/** 将 API 返回的 proposals 同步到 IndexedDB */
async function _syncProposalsToIdb(proposals: ProposalInfo[]) {
    if (proposals.length > 0) {
        await dbPutMany(STORES.PROPOSALS, proposals)
    }
    // 清理 IndexedDB 中已不再 pending 的旧记录
    const all = await dbGetAll<ProposalInfo>(STORES.PROPOSALS)
    const pendingIds = new Set(proposals.map(p => p.id))
    const stale = all.filter(p => p.status === 'pending' && !pendingIds.has(p.id)).map(p => p.id)
    if (stale.length > 0) {
        await dbDeleteMany(STORES.PROPOSALS, stale)
    }
}
