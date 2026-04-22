import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { profileApi } from '../../api'
import type { UserProfile } from '../../stores/profile'
import { broadcastSync } from '../../utils/broadcast'
import { getCachedMe, getCachedStats } from '../../utils/userCache'

export const profileKeys = {
    all: ['profile'] as const,
    me: () => [...profileKeys.all, 'me'] as const,
    stats: () => [...profileKeys.all, 'stats'] as const,
}

/**
 * 获取当前用户信息 Query（/auth/me）
 */
export function useProfileQuery() {
    return useQuery({
        queryKey: profileKeys.me(),
        initialData: getCachedMe,
        queryFn: () => profileApi.getMe(),
        staleTime: 1000 * 60 * 30, // 30 分钟缓存
    })
}

/**
 * 获取用户统计数据 Query
 */
export function useStatsQuery() {
    return useQuery({
        queryKey: profileKeys.stats(),
        initialData: getCachedStats,
        queryFn: () => profileApi.getStats(),
        staleTime: 1000 * 60 * 5, // 5 分钟缓存
    })
}

/**
 * 更新用户资料 Mutation（PUT /auth/me）
 */
export function useUpdateProfileMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: Partial<Pick<UserProfile, 'username' | 'bio' | 'avatarUrl' | 'preferences'>>) =>
            profileApi.updateMe(data),
        onSuccess: (updatedData) => {
            queryClient.setQueryData(profileKeys.me(), updatedData)
            broadcastSync('RELOAD_PROFILE', undefined)
        }
    })
}

/**
 * 修改密码 Mutation
 */
export function useChangePasswordMutation() {
    return useMutation({
        mutationFn: ({ oldPassword, newPassword }: any) =>
            profileApi.changePassword(oldPassword, newPassword)
    })
}

/**
 * 删除账号 Mutation
 */
export function useDeleteAccountMutation() {
    return useMutation({
        mutationFn: (password: string) => profileApi.deleteAccount(password)
    })
}
