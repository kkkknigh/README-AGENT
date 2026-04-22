import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { proposalApi } from '../../api'
import type { ProposalInfo } from '../../types'
import { STORES, dbPutMany, dbGetAll, dbUpdate, dbDeleteMany } from '../../utils/db'

export const proposalKeys = {
    pending: ['proposals', 'pending'] as const,
}

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
    } catch { /* IndexedDB unavailable */ }
}

export function useProposalAction() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ id, action, comment }: {
            id: string
            action: 'approve' | 'reject'
            comment?: string
        }) => proposalApi.action(id, action, comment),
        onMutate: async ({ id, action }) => {
            await queryClient.cancelQueries({ queryKey: proposalKeys.pending })
            const previous = queryClient.getQueryData<ProposalInfo[]>(proposalKeys.pending)
            const newStatus = action === 'approve' ? 'approved' as const : 'rejected' as const
            queryClient.setQueryData<ProposalInfo[]>(proposalKeys.pending, (old) =>
                (old ?? []).map(p => p.id === id ? { ...p, status: newStatus } : p)
            )
            dbUpdate<ProposalInfo>(STORES.PROPOSALS, id, { status: newStatus }).catch(console.warn)
            return { previous }
        },
        onError: (_err, _vars, context) => {
            if (context?.previous) {
                queryClient.setQueryData(proposalKeys.pending, context.previous)
            }
        },
        onSuccess: (data, variables) => {
            const actionType = data?.proposal?.action_type
            const mutation = data?.mutation
            if (actionType === 'manage_notes') {
                queryClient.invalidateQueries({ queryKey: ['notes'] })
            }
            if (actionType === 'manage_kg_node' || actionType === 'manage_kg_edge') {
                queryClient.invalidateQueries({ queryKey: ['roadmap'] })
            }
            if (actionType === 'tag') {
                queryClient.invalidateQueries({ queryKey: ['documents'] })
                queryClient.invalidateQueries({ queryKey: ['documents-search'] })
            }
            if (variables.action === 'approve') {
                queryClient.invalidateQueries({ queryKey: ['chat', 'messages'] })
            }
            if (mutation?.resource === 'notes') {
                queryClient.invalidateQueries({ queryKey: ['notes'] })
            }
            if (mutation?.resource === 'kg_node' || mutation?.resource === 'kg_edge') {
                queryClient.invalidateQueries({ queryKey: ['roadmap'] })
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: proposalKeys.pending })
            queryClient.invalidateQueries({ queryKey: ['documents'] })
            queryClient.invalidateQueries({ queryKey: ['documents-search'] })
        },
    })
}

export async function clearProposalsForSession(sessionId: string) {
    try {
        const all = await dbGetAll<ProposalInfo>(STORES.PROPOSALS)
        const toDelete = all.filter(p => p.session_id === sessionId).map(p => p.id)
        if (toDelete.length > 0) {
            await dbDeleteMany(STORES.PROPOSALS, toDelete)
        }
    } catch { /* silent */ }
}

async function _syncProposalsToIdb(proposals: ProposalInfo[]) {
    if (proposals.length > 0) {
        await dbPutMany(STORES.PROPOSALS, proposals)
    }
    const all = await dbGetAll<ProposalInfo>(STORES.PROPOSALS)
    const pendingIds = new Set(proposals.map(p => p.id))
    const stale = all.filter(p => p.status === 'pending' && !pendingIds.has(p.id)).map(p => p.id)
    if (stale.length > 0) {
        await dbDeleteMany(STORES.PROPOSALS, stale)
    }
}
