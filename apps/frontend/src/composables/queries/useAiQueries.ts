import { toValue, type MaybeRefOrGetter, computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { aiApi } from '../../api'
import { STORES, dbPut, dbGet } from '../../utils/db'

/**
 * Roadmap (学习路线图) Query
 */
export const useRoadmapQuery = (pdfId: MaybeRefOrGetter<string | null>) => {
    const queryClient = useQueryClient()
    return useQuery({
        queryKey: ['roadmap', pdfId],
        queryFn: async () => {
            const id = toValue(pdfId)
            if (!id) return null
            if (!queryClient.getQueryData(['roadmap', id])) {
                const cached = await dbGet<{ id: string; data: any }>(STORES.ROADMAPS, id).catch(() => null)
                if (cached?.data) return cached.data
            }
            const result = await aiApi.generateRoadmap(id)
            if (result) {
                dbPut(STORES.ROADMAPS, { id, data: result }).catch(console.warn)
            }
            return result
        },
        enabled: computed(() => !!toValue(pdfId)),
        staleTime: 24 * 60 * 60 * 1000, // 24小时，路线图相对固定
    })
}

/**
 * Brief Report（论文结构化摘要）Query
 */
export const useBriefQuery = (pdfId: MaybeRefOrGetter<string | null>) => {
    const queryClient = useQueryClient()
    return useQuery({
        queryKey: ['brief', pdfId],
        queryFn: async () => {
            const id = toValue(pdfId)
            if (!id) return null
            if (!queryClient.getQueryData(['brief', id])) {
                const cached = await dbGet<{ id: string; data: any }>(STORES.BRIEFS, id).catch(() => null)
                if (cached?.data) return cached.data
            }
            const result = await aiApi.generateBrief(id)
            if (result) {
                dbPut(STORES.BRIEFS, { id, data: result }).catch(console.warn)
            }
            return result
        },
        enabled: computed(() => !!toValue(pdfId)),
    })
}
