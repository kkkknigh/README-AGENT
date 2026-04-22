import { toValue, type MaybeRefOrGetter, computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { linkApi } from '../../api'

/**
 * 内部链接数据 Query
 * 用于在点击 PDF 内部链接时获取该链接指向的文献/内容信息
 */
export const useInternalLinkQuery = (
    pdfId: MaybeRefOrGetter<string | null>,
    paragraphId: MaybeRefOrGetter<string | null>
) => {
    return useQuery({
        queryKey: ['link-data', pdfId, paragraphId],
        queryFn: async () => {
            const docId = toValue(pdfId)
            const pId = toValue(paragraphId)
            if (!docId || !pId) return null

            return linkApi.getLinkData(docId, pId)
        },
        enabled: computed(() => !!toValue(pdfId) && !!toValue(paragraphId)),
        staleTime: Infinity, // 内部链接指向的内容通常不变
    })
}

/**
 * 强制重试获取链接数据 Mutation
 */
export const useRetryLinkMutation = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ pdfId, paragraphId }: { pdfId: string, paragraphId: string }) => {
            return linkApi.getLinkData(pdfId, paragraphId, true)
        },
        onSuccess: (_, variables) => {
            // 成功后作废旧缓存，强制 UI 重新获取最新数据
            queryClient.invalidateQueries({
                queryKey: ['link-data', variables.pdfId, variables.paragraphId]
            })
        }
    })
}
