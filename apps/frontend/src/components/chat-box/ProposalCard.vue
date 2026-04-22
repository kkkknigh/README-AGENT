<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'
import type { ProposalInfo } from '../../types'

const { renderMarkdown } = useMarkdownRenderer()

const props = defineProps<{
  proposal: ProposalInfo
}>()

const emit = defineEmits<{
  (e: 'approve', id: string): void
  (e: 'reject', id: string): void
}>()

// 点击后立即禁用按钮，防止重复操作和竞态
const actionTaken = ref(false)

// proposal 状态回到 pending（如乐观更新回滚）时重置
watch(() => props.proposal.status, (status) => {
  if (status === 'pending') actionTaken.value = false
})

const handleApprove = () => {
  if (actionTaken.value) return
  actionTaken.value = true
  emit('approve', props.proposal.id)
}

const handleReject = () => {
  if (actionTaken.value) return
  actionTaken.value = true
  emit('reject', props.proposal.id)
}

const colorMap: Record<string, { badge: string; border: string }> = {
  manage_notes: {
    badge: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700/40',
    border: 'border-l-emerald-500',
  },
  manage_kg_node: {
    badge: 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:text-indigo-300 dark:bg-indigo-900/20 dark:border-indigo-700/40',
    border: 'border-l-indigo-500',
  },
  manage_kg_edge: {
    badge: 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:text-indigo-300 dark:bg-indigo-900/20 dark:border-indigo-700/40',
    border: 'border-l-indigo-500',
  },
  tag: {
    badge: 'text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-900/20 dark:border-violet-700/40',
    border: 'border-l-violet-500',
  },
  import_paper: {
    badge: 'text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-300 dark:bg-orange-900/20 dark:border-orange-700/40',
    border: 'border-l-orange-500',
  },
  save_blog: {
    badge: 'text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-900/20 dark:border-sky-700/40',
    border: 'border-l-sky-500',
  },
}

const defaultColor = {
  badge: 'text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-800/50 dark:border-slate-600/40',
  border: 'border-l-slate-400',
}

const colors = computed(() => colorMap[props.proposal.action_type] || defaultColor)

const expiresTime = computed(() => {
  if (!props.proposal.expires_at) return ''
  try {
    return new Date(props.proposal.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
})
</script>

<template>
  <div
    class="rounded-xl bg-gray-50 dark:bg-[#2a2a2d] border border-gray-100/80 dark:border-slate-700/60 border-l-[3px] px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-200"
    :class="colors.border"
  >
    <!-- Header: Badge + Title -->
    <div class="flex items-center gap-2 mb-1.5">
      <span
        class="text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded border flex-shrink-0"
        :class="colors.badge"
      >{{ proposal.action_type_label }}</span>
      <span class="text-[13px] font-semibold text-slate-800 dark:text-gray-100 truncate">
        {{ proposal.title }}
      </span>
    </div>

    <!-- Pending: Full card -->
    <template v-if="proposal.status === 'pending'">
      <p class="text-[11.5px] text-slate-600 dark:text-slate-400 line-clamp-2 mb-2 leading-relaxed markdown-body prose prose-sm max-w-none dark:prose-invert" v-html="renderMarkdown(proposal.description)">
      </p>
      <div class="flex items-center justify-between">
        <div v-if="!actionTaken" class="flex items-center gap-2">
          <button
            @click="handleApprove"
            class="text-[11px] px-2.5 py-1 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 transition-colors font-medium"
          >批准</button>
          <button
            @click="handleReject"
            class="text-[11px] px-2.5 py-1 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >拒绝</button>
        </div>
        <div v-else class="flex items-center gap-2">
          <svg class="w-3 h-3 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span class="text-[11px] text-slate-500 dark:text-slate-400">处理中...</span>
        </div>
        <span v-if="expiresTime" class="text-[10px] text-slate-400">{{ expiresTime }} 过期</span>
      </div>
    </template>

    <!-- Approved: Compact with spinner -->
    <div v-else-if="proposal.status === 'approved'" class="flex items-center gap-2 mt-0.5">
      <svg class="w-3 h-3 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span class="text-[11px] text-slate-500 dark:text-slate-400">执行中...</span>
    </div>

    <!-- Executed: Compact with check -->
    <div v-else-if="proposal.status === 'executed'" class="flex items-center gap-2 mt-0.5">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
      <span class="text-[11px] text-emerald-600 dark:text-emerald-400">已完成</span>
    </div>

    <!-- Rejected: Compact -->
    <div v-else-if="proposal.status === 'rejected'" class="flex items-center gap-2 mt-0.5">
      <span class="text-[11px] text-slate-400">已拒绝</span>
      <span v-if="proposal.review_comment" class="text-[10px] text-slate-400 truncate max-w-[200px]">
        · {{ proposal.review_comment }}
      </span>
    </div>

    <!-- Expired -->
    <div v-else-if="proposal.status === 'expired'" class="flex items-center gap-2 mt-0.5">
      <span class="text-[11px] text-amber-500 dark:text-amber-400">已过期</span>
    </div>

    <!-- Cancelled -->
    <div v-else-if="proposal.status === 'cancelled'" class="flex items-center gap-2 mt-0.5">
      <span class="text-[11px] text-slate-400">已取消</span>
    </div>

    <!-- Failed -->
    <div v-else-if="proposal.status === 'failed'" class="flex items-center gap-2 mt-0.5">
      <span class="text-[11px] text-red-500 dark:text-red-400">执行失败</span>
    </div>
  </div>
</template>
