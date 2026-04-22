import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { highlightApi } from '../../api'
import { broadcastSync } from '../../utils/broadcast'
import { STORES, dbPut, dbGet } from '../../utils/db'

const TEMP_HIGHLIGHT_PREFIX = 'temp-highlight-'
const pendingDeleteTempIds = new Set<string>()

const isTempHighlightId = (id: string) => id.startsWith(TEMP_HIGHLIGHT_PREFIX)
const sameId = (a: unknown, b: unknown) => String(a) === String(b)

export const useHighlightsQuery = (pdfId: MaybeRefOrGetter<string | null>) => {
    const queryClient = useQueryClient()
    return useQuery({
        queryKey: computed(() => ['highlights', toValue(pdfId)]),
        queryFn: async () => {
            const id = toValue(pdfId)
            if (!id) return []
            // 冷启动（内存无数据）→ IDB 优先；invalidate 重刷 → 跳过 IDB，请求后端
            if (!queryClient.getQueryData(['highlights', id])) {
                const cached = await dbGet<{ id: string; highlights: any[] }>(STORES.HIGHLIGHTS, id).catch(() => null)
                if (cached && Array.isArray(cached.highlights)) return cached.highlights
            }
            const { success, highlights } = await highlightApi.getHighlights(id)
            if (success && Array.isArray(highlights)) {
                const mapped = highlights.map(item => ({
                    id: String(item.id),
                    page: item.page,
                    rects: Array.isArray(item.rects)
                        ? item.rects.map((r: any) => ({
                            left: r.x0 ?? r.x ?? r.left ?? 0,
                            top: r.y0 ?? r.y ?? r.top ?? 0,
                            width: (r.x1 !== undefined && (r.x0 !== undefined || r.x !== undefined || r.left !== undefined))
                                ? (r.x1 - (r.x0 ?? r.x ?? r.left ?? 0))
                                : (r.width ?? 0),
                            height: (r.y1 !== undefined && (r.y0 !== undefined || r.y !== undefined || r.top !== undefined))
                                ? (r.y1 - (r.y0 ?? r.y ?? r.top ?? 0))
                                : (r.height ?? 0)
                        }))
                        : [],
                    text: item.text || '',
                    color: item.color || '#F6E05E'
                }))
                dbPut(STORES.HIGHLIGHTS, { id, highlights: mapped }).catch(console.warn)
                return mapped
            }
            dbPut(STORES.HIGHLIGHTS, { id, highlights: [] }).catch(console.warn)
            return []
        },
        enabled: () => !!toValue(pdfId),
    })
}

export const useCreateHighlightMutation = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: any) => highlightApi.createHighlight(data),
        onMutate: async (variables) => {
            const queryKey = ['highlights', variables.pdfId]
            await queryClient.cancelQueries({ queryKey })
            const previousHighlights = queryClient.getQueryData<any[]>(queryKey)

            const optimisticId = `temp-highlight-${Date.now()}`
            const optimisticHighlight = {
                id: optimisticId,
                page: variables.page,
                rects: Array.isArray(variables.rects) ? variables.rects : [],
                text: variables.text || '',
                color: variables.color || '#F6E05E',
            }

            queryClient.setQueryData<any[]>(queryKey, (old) => {
                const next = Array.isArray(old) ? [...old] : []
                next.push(optimisticHighlight)
                return next
            })

            return { queryKey, previousHighlights, optimisticId }
        },
        onError: (_err, _variables, context) => {
            if (context?.optimisticId) {
                pendingDeleteTempIds.delete(context.optimisticId)
            }
            if (context?.previousHighlights) {
                queryClient.setQueryData(context.queryKey, context.previousHighlights)
                return
            }
            if (context?.queryKey) {
                queryClient.setQueryData<any[]>(context.queryKey, (old) => {
                    if (!Array.isArray(old)) return old
                    return old.filter((item) => !sameId(item.id, context.optimisticId))
                })
            }
        },
        onSuccess: async (response, variables, context) => {
            const optimisticId = context?.optimisticId
            const createdId = String(response?.id ?? '')

            // If user clicked "cancel highlight" before create finished,
            // immediately remove the optimistic item and delete the real one once available.
            if (optimisticId && pendingDeleteTempIds.has(optimisticId)) {
                pendingDeleteTempIds.delete(optimisticId)

                if (context?.queryKey) {
                    queryClient.setQueryData<any[]>(context.queryKey, (old) => {
                        if (!Array.isArray(old)) return old
                        return old.filter((item) => !sameId(item.id, optimisticId))
                    })
                }

                if (createdId) {
                    try {
                        await highlightApi.deleteHighlight(createdId)
                    } catch (_e) {
                        // Fall back to refetch to avoid stale UI when immediate delete fails.
                    }
                }

                broadcastSync('RELOAD_HIGHLIGHTS', variables.pdfId)
                return
            }

            if (context?.queryKey) {
                queryClient.setQueryData<any[]>(context.queryKey, (old) => {
                    if (!Array.isArray(old)) return old
                    return old.map((item) =>
                        sameId(item.id, context.optimisticId)
                            ? { ...item, id: String(response?.id ?? item.id) }
                            : item
                    )
                })
                // 同步最新缓存到 IDB
                const current = queryClient.getQueryData<any[]>(context.queryKey)
                if (current) dbPut(STORES.HIGHLIGHTS, { id: variables.pdfId, highlights: current }).catch(console.warn)
            }
            broadcastSync('RELOAD_HIGHLIGHTS', variables.pdfId)
        },
    })
}

export const useUpdateHighlightMutation = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, color, pdfId: _pdfId }: { id: string, color: string, pdfId: string }) =>
            highlightApi.updateHighlight(id, color),
        onMutate: async (variables) => {
            const queryKey = ['highlights', variables.pdfId]
            await queryClient.cancelQueries({ queryKey })
            const previousHighlights = queryClient.getQueryData<any[]>(queryKey)

            queryClient.setQueryData<any[]>(queryKey, (old) => {
                if (!Array.isArray(old)) return old
                return old.map((item) =>
                    sameId(item.id, variables.id)
                        ? { ...item, color: variables.color }
                        : item
                )
            })

            return { queryKey, previousHighlights }
        },
        onError: (_err, _variables, context) => {
            if (context?.previousHighlights) {
                queryClient.setQueryData(context.queryKey, context.previousHighlights)
            }
        },
        onSuccess: (_, variables) => {
            // 同步最新缓存到 IDB
            const current = queryClient.getQueryData<any[]>(['highlights', variables.pdfId])
            if (current) dbPut(STORES.HIGHLIGHTS, { id: variables.pdfId, highlights: current }).catch(console.warn)
            broadcastSync('RELOAD_HIGHLIGHTS', variables.pdfId)
        },
    })
}

export const useDeleteHighlightMutation = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ id, pdfId: _pdfId }: { id: string, pdfId: string }) => {
            if (isTempHighlightId(id)) {
                pendingDeleteTempIds.add(id)
                return { success: true }
            }
            return highlightApi.deleteHighlight(id)
        },
        onMutate: async (variables) => {
            const queryKey = ['highlights', variables.pdfId]
            await queryClient.cancelQueries({ queryKey })
            const previousHighlights = queryClient.getQueryData<any[]>(queryKey)

            queryClient.setQueryData<any[]>(queryKey, (old) => {
                if (!Array.isArray(old)) return old
                return old.filter((item) => !sameId(item.id, variables.id))
            })

            return { queryKey, previousHighlights }
        },
        onError: (_err, _variables, context) => {
            if (context?.previousHighlights) {
                queryClient.setQueryData(context.queryKey, context.previousHighlights)
            }
        },
        onSuccess: (_, variables) => {
            // 同步最新缓存到 IDB
            const current = queryClient.getQueryData<any[]>(['highlights', variables.pdfId])
            if (current) dbPut(STORES.HIGHLIGHTS, { id: variables.pdfId, highlights: current }).catch(console.warn)
            broadcastSync('RELOAD_HIGHLIGHTS', variables.pdfId)
        },
    })
}
