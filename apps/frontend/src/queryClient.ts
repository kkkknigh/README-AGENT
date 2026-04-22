import { QueryClient } from '@tanstack/vue-query'

/**
 * 全局共享的 QueryClient 实例。
 * 将其解耦并在单独的文件中导出，以允许在 Pinia store、axios 拦截器或其它非组件代码中通过导入使用，
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 单用户应用，所有数据变更都由 mutation 驱动 invalidation，
      // 数据永远不会"自己变陈旧"，因此使用 Infinity 避免无意义的后台 refetch
      staleTime: Infinity,
      gcTime: 1000 * 60 * 60 * 24, // 保持 24 小时以支持持久化
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})
