<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'
import { useImportLinkFlow } from '../../composables/useImportLinkFlow'
import type { ChatMessage, Citation, ProposalInfo } from '../../types'
import ProposalCard from './ProposalCard.vue'

const props = defineProps<{
  messages: ChatMessage[]
  isLoadingContent: boolean
  selectionMode?: boolean
  selectedIds?: Set<string>
  proposals?: ProposalInfo[]
}>()

const emit = defineEmits<{
  (e: 'click-citation', citations: Citation[], event: MouseEvent): void
  (e: 'resend', index: number): void
  (e: 'resend-edited', index: number, content: string): void
  (e: 'toggle-selection', id: string): void
  (e: 'proposal-approve', id: string): void
  (e: 'proposal-reject', id: string): void
}>()

const { tooltipState, renderMarkdown, handleMessageMouseOver, handleMessageMouseOut, handleMessageClick, handleTooltipEnter, handleTooltipLeave } = useMarkdownRenderer()

const messagesContainer = ref<HTMLElement | null>(null)
const editingIndex = ref<number | null>(null)
const editValue = ref('')

// --- 思考块折叠状态： key 为 message.id，只在内存中保存，不持久化 ---
const thinkingExpanded = ref<Record<string, boolean>>({})

const isThinkingExpanded = (id: string) => thinkingExpanded.value[id] ?? true

const toggleThinking = (id: string) => {
  thinkingExpanded.value[id] = !isThinkingExpanded(id)
}

// final（content 非空）到达后自动折叠思考块
watch(() => props.messages, (msgs) => {
  msgs.forEach(m => {
    if (m.role === 'assistant' && m.thoughts?.length && m.content && !(m.id in thinkingExpanded.value)) {
      thinkingExpanded.value[m.id] = false
    }
  })
}, { deep: true })

// --- 步骤块折叠状态（与思考块相同模式）---
const stepsExpanded = ref<Record<string, boolean>>({})

const isStepsExpanded = (id: string) => stepsExpanded.value[id] ?? true

const toggleSteps = (id: string) => {
  stepsExpanded.value[id] = !isStepsExpanded(id)
}

// content 非空后自动折叠步骤块
watch(() => props.messages, (msgs) => {
  msgs.forEach(m => {
    if (m.role === 'assistant' && m.steps?.length && m.content && !(m.id in stepsExpanded.value)) {
      stepsExpanded.value[m.id] = false
    }
  })
}, { deep: true })

const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

// 自动滚动
watch(() => props.messages.length, () => {
  nextTick(scrollToBottom)
})

const onCitationClick = (event: MouseEvent, citations: Citation[]) => {
  handleMessageClick(event, citations)
  emit('click-citation', citations, event)
}

const startEdit = (index: number, content: string) => {
  editingIndex.value = index
  editValue.value = content
}

const cancelEdit = () => {
  editingIndex.value = null
  editValue.value = ''
}

const submitEdit = (index: number) => {
  if (editValue.value.trim()) {
    emit('resend-edited', index, editValue.value.trim())
    editingIndex.value = null
  }
}

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text)
}

const vFocus = {
  mounted: (el: HTMLElement) => el.focus()
}

const getCitationSourceLabel = (cite: Citation) => {
  const sourceType = cite.source_type
  if (sourceType === 'vector') return '知识库'
  if (sourceType === 'graph') return '关系网络'
  if (sourceType === 'external_ss') return 'Semantic Scholar'
  if (sourceType === 'external_arxiv') return 'ArXiv'
  if (sourceType === 'external_web') return 'Web'
  if (sourceType === 'external_related') return 'Related'
  return '外部来源'
}

const getCitationChipClass = (cite: Citation) => {
  const sourceType = cite.source_type
  if (sourceType === 'vector') return 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700/40'
  if (sourceType === 'graph') return 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:text-indigo-300 dark:bg-indigo-900/20 dark:border-indigo-700/40'
  if (sourceType === 'external_ss') return 'text-cyan-700 bg-cyan-50 border-cyan-200 dark:text-cyan-300 dark:bg-cyan-900/20 dark:border-cyan-700/40'
  if (sourceType === 'external_arxiv') return 'text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-300 dark:bg-orange-900/20 dark:border-orange-700/40'
  if (sourceType === 'external_web') return 'text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-900/20 dark:border-sky-700/40'
  if (sourceType === 'external_related') return 'text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-900/20 dark:border-violet-700/40'
  return 'text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-800/50 dark:border-slate-600/40'
}

const formatCitationCount = (count?: number) => {
  if (typeof count !== 'number' || Number.isNaN(count)) return ''
  if (count < 1000) return `${count}`
  return `${(count / 1000).toFixed(1)}k`
}

const getCitationSourceCode = (cite: Citation) => {
  const sourceType = cite.source_type
  if (sourceType === 'vector') return 'KB'
  if (sourceType === 'graph') return 'KG'
  if (sourceType === 'external_ss') return 'SS'
  if (sourceType === 'external_arxiv') return 'ARX'
  if (sourceType === 'external_web') return 'WEB'
  if (sourceType === 'external_related') return 'REL'
  return 'EXT'
}

const getCitationDomain = (cite: Citation) => {
  if (!cite.url) return ''
  try {
    const host = new URL(cite.url).hostname || ''
    return host.replace(/^www\./, '')
  } catch (_error) {
    return ''
  }
}

// ---- 从引用卡片导入到文献库 ----
const { startImportLink, isImportingLink } = useImportLinkFlow()
const importedUrls = ref(new Set<string>())

const isExternalCitation = (cite: Citation) => {
  return cite.source_type?.startsWith('external') && !!cite.url
}

const handleImportCitation = async (cite: Citation) => {
  if (!cite.url || importedUrls.value.has(cite.url)) return
  try {
    await startImportLink(cite.url)
    importedUrls.value.add(cite.url)
  } catch (e) {
    console.error('[Citation Import] Failed:', e)
  }
}

const getDisplayCitations = (citations: Citation[] = [], maxItems: number = 8) => {
  // 保持后端过滤+编号后的原始顺序，不再重排
  return citations.slice(0, maxItems)
}

defineExpose({
  scrollToBottom
})
</script>

<template>
  <div class="h-full flex flex-col relative w-full overflow-hidden">
    <!-- Tooltip Component (Global Absolute Position within List) -->
    <div 
      v-if="tooltipState.visible && tooltipState.content"
      class="msg-tooltip fixed z-[100] w-80 p-3 transition-opacity duration-200 overflow-hidden"
      :style="{ left: Math.min(tooltipState.x - 20, 1024) + 'px', top: (tooltipState.y - 8) + 'px', transform: 'translateY(-100%)' }"
      @mouseenter="handleTooltipEnter"
      @mouseleave="handleTooltipLeave"
    >
      <!-- Header: Type -->
      <div class="flex items-center justify-between mb-2">
        <span class="text-[9px] font-bold text-primary-500 dark:text-gray-300 uppercase tracking-widest">
          {{ getCitationSourceLabel(tooltipState.content) }}
        </span>
        <span v-if="tooltipState.content.score" class="text-[9px] text-primary-500/90 dark:text-gray-400">
          相似度 {{ (tooltipState.content.score * 100).toFixed(0) }}%
        </span>
      </div>

      <!-- Name -->
      <h4 class="font-bold text-xs text-slate-800 dark:text-gray-100 mb-1.5 leading-tight">
        {{ tooltipState.content.name || '检索内容' }}
      </h4>

      <!-- Text -->
      <div class="text-[11px] text-slate-700 dark:text-gray-300 leading-normal bg-primary-50/20 dark:bg-white/5 p-2 rounded border border-primary-100/50 dark:border-gray-800/50 line-clamp-6 markdown-body prose prose-sm max-w-none dark:prose-invert" v-html="renderMarkdown(tooltipState.content.text)">
      </div>

      <div class="mt-2 flex flex-wrap gap-1.5">
        <span v-if="tooltipState.content.citation_count !== undefined" class="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          引用 {{ formatCitationCount(tooltipState.content.citation_count) }}
        </span>
        <span v-if="getCitationDomain(tooltipState.content)" class="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {{ getCitationDomain(tooltipState.content) }}
        </span>
        <span v-if="tooltipState.content.venue" class="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 max-w-[180px] truncate" :title="tooltipState.content.venue">
          {{ tooltipState.content.venue }}
        </span>
        <span v-if="tooltipState.content.published_date" class="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {{ tooltipState.content.published_date }}
        </span>
      </div>

      <!-- Footer -->
      <div v-if="tooltipState.content.url || tooltipState.content.page" class="flex items-center justify-between mt-2 text-[9px]">
        <button
          v-if="isExternalCitation(tooltipState.content)"
          @click.stop="handleImportCitation(tooltipState.content)"
          :disabled="isImportingLink || importedUrls.has(tooltipState.content.url!)"
          class="inline-flex items-center gap-1 px-2 py-1 rounded border font-medium transition-colors"
          :class="importedUrls.has(tooltipState.content.url!)
            ? 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/20 dark:border-emerald-700/40 cursor-default'
            : 'text-primary-600 bg-primary-50 border-primary-200 hover:bg-primary-100 dark:text-primary-400 dark:bg-primary-900/20 dark:border-primary-700/40 dark:hover:bg-primary-900/40 cursor-pointer'"
        >
          <svg v-if="importedUrls.has(tooltipState.content.url!)" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <svg v-else-if="isImportingLink" class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <svg v-else class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ importedUrls.has(tooltipState.content.url!) ? '已导入' : isImportingLink ? '导入中' : '导入文献库' }}
        </button>
        <span v-else />
        <a v-if="tooltipState.content.url" :href="tooltipState.content.url" target="_blank" rel="noopener noreferrer" class="text-primary-600 hover:underline cursor-pointer font-medium">查看详情</a>
        <span v-else class="text-slate-400">第 {{ tooltipState.content.page }} 页</span>
      </div>
    </div>



    <!-- Messages Area -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto w-full px-3 pt-4 pb-2 space-y-3">
      <!-- Message List -->
      <div 
        v-for="(message, index) in messages" 
        :key="'msg-' + index" 
        class="relative group"
        :class="message.role === 'user' ? 'flex justify-end' : 'flex justify-start'"
      >
        <!-- Selection Checkbox (left side for all) -->
        <div v-if="selectionMode" class="flex-shrink-0 pt-2 mr-2">
          <input 
            type="checkbox" 
            :checked="selectedIds?.has(message.id)"
            @change="emit('toggle-selection', message.id)"
            class="w-3.5 h-3.5 rounded border-primary-200 dark:border-slate-700 text-primary-600 dark:text-slate-100 focus:ring-0 focus:ring-offset-0 cursor-pointer transition-colors"
            title="选择消息"
          >
        </div>

        <!-- Message Bubble -->
        <div class="w-full">
          <!-- Content -->
          <div 
            :class="[
              'transition-all duration-200',
              message.role === 'user' 
                ? 'msg-bubble-user px-4 py-3 rounded-xl bg-primary-600 dark:bg-primary-700 text-white' 
                : 'msg-bubble-ai px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#2a2a2d] border border-gray-100/80 dark:border-slate-700/60'
            ]"
          >
            <!-- Edit Mode -->
            <div v-if="editingIndex === index" class="animate-in fade-in zoom-in-95 duration-200">
              <textarea 
                v-model="editValue"
                class="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-sm leading-snug text-white placeholder-white/50 resize-none p-0 overflow-hidden"
                placeholder="编辑消息..."
                style="field-sizing: content;"
                v-focus
              ></textarea>
              <div class="flex justify-end gap-2 mt-3 pt-2 border-t border-white/15">
                <button @click="cancelEdit" class="px-2.5 py-1 text-[11px] text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors">取消</button>
                <button @click="submitEdit(index)" class="px-2.5 py-1 text-[11px] bg-white/20 text-white hover:bg-white/30 rounded-md transition-colors">确认重发</button>
              </div>
            </div>

            <template v-else>
              <!-- User Message Content -->
              <div v-if="message.role === 'user'">
                <div v-if="message.images?.length" class="flex flex-wrap gap-2 mb-2">
                  <img
                    v-for="(img, imgIdx) in message.images"
                    :key="imgIdx"
                    :src="img"
                    class="max-h-36 max-w-full rounded-lg border border-white/20 object-contain"
                  />
                </div>
                <p class="text-[13px] whitespace-pre-wrap break-words leading-relaxed">
                  {{ message.content }}
                </p>
              </div>
              
              <!-- Assistant Message Content -->
              <div v-else class="space-y-1.5">
                <!-- Thinking Block -->
                <div v-if="message.thoughts?.length" class="mb-1.5">
                  <button
                    @click="toggleThinking(message.id)"
                    class="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors group/th select-none"
                  >
                    <svg
                      class="w-3 h-3 transition-transform duration-200"
                      :class="isThinkingExpanded(message.id) ? 'rotate-90' : ''"
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                    <span class="font-medium tracking-wide">思考过程</span>
                    <span class="opacity-60">({{ message.thoughts.length }} 条)</span>
                  </button>
                  <div
                    v-if="isThinkingExpanded(message.id)"
                    class="mt-1.5 ml-1 pl-3 border-l-2 border-slate-200 dark:border-slate-700 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200"
                  >
                    <p
                      v-for="(thought, ti) in message.thoughts"
                      :key="ti"
                      class="text-[11.5px] text-slate-500 dark:text-slate-400 leading-relaxed"
                    >{{ thought }}</p>
                  </div>
                </div>
                <!-- Steps Block -->
                <div v-if="message.steps?.length" class="mb-1.5">
                  <button
                    @click="toggleSteps(message.id)"
                    class="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors group/st select-none"
                  >
                    <svg
                      class="w-3 h-3 transition-transform duration-200"
                      :class="isStepsExpanded(message.id) ? 'rotate-90' : ''"
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                    <span class="font-medium tracking-wide">执行步骤</span>
                    <span class="opacity-60">({{ message.steps.length }})</span>
                  </button>
                  <div
                    v-if="isStepsExpanded(message.id)"
                    class="mt-1.5 ml-1 pl-3 border-l-2 border-slate-200 dark:border-slate-700 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200"
                  >
                    <div
                      v-for="(step, si) in message.steps"
                      :key="si"
                      class="flex items-center gap-2 text-[11.5px]"
                    >
                      <span
                        :class="step.status === 'done'
                          ? 'w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0'
                          : 'w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse flex-shrink-0'"
                      />
                      <span class="text-slate-500 dark:text-slate-400 leading-relaxed">{{ step.text }}</span>
                    </div>
                  </div>
                </div>

                <div
                  v-if="message.content"
                  class="markdown-body prose prose-sm max-w-none dark:prose-invert
                         prose-pre:bg-[#282c34] prose-pre:m-0
                         prose-headings:font-semibold prose-headings:text-gray-800 dark:prose-headings:text-gray-100
                         prose-a:text-primary-500 dark:prose-a:text-primary-400 prose-a:no-underline hover:prose-a:underline
                         text-gray-700 dark:text-gray-200 text-[13px] leading-relaxed"
                  v-html="renderMarkdown(message.content)"
                  @mouseover="handleMessageMouseOver($event, message.citations || [])"
                  @mouseout="handleMessageMouseOut"
                  @click="onCitationClick($event, message.citations || [])"
                ></div>
                <p
                  v-else-if="!message.steps?.length"
                  class="text-[12px] text-slate-400 dark:text-slate-500 italic"
                >正在生成回复...</p>

                <!-- AI Citations -->
                <div v-if="message.citations?.length" class="flex items-center gap-x-2 gap-y-1 flex-wrap pt-0.5 pb-0.5 text-[11px]">
                  <span 
                    v-for="(cite, citeIdx) in getDisplayCitations(message.citations || [])" 
                    :key="cite.id || citeIdx"
                    :class="[
                      'citation-ref font-medium cursor-pointer transition-colors duration-200 whitespace-nowrap inline-flex items-center gap-1 px-1.5 py-0.5 rounded border',
                      getCitationChipClass(cite)
                    ]"
                    :data-id="citeIdx + 1"
                    @mouseover="handleMessageMouseOver($event, getDisplayCitations(message.citations || []))"
                    @mouseout="handleMessageMouseOut"
                    @click="onCitationClick($event, getDisplayCitations(message.citations || []))"
                  >
                    <span class="text-[9px] font-bold opacity-80">{{ getCitationSourceCode(cite) }}</span>
                    <span class="opacity-70">[{{ citeIdx + 1 }}]</span>
                    <span class="max-w-[120px] truncate inline-block align-bottom">{{ cite.name || '检索片段' }}</span>
                    <span v-if="getCitationDomain(cite)" class="opacity-70 max-w-[110px] truncate">· {{ getCitationDomain(cite) }}</span>
                    <span v-if="cite.citation_count !== undefined" class="opacity-70">· C{{ formatCitationCount(cite.citation_count) }}</span>
                  </span>
                </div>
              </div>
            </template>
          </div>

          <!-- Footer: Timestamp + Actions -->
          <div 
            class="mt-1 flex items-center gap-2 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
            :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <span class="text-[10px] text-slate-500 dark:text-slate-400">
              {{ new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
            </span>
            <span v-if="message.role === 'user' && message.meta?.edited" class="text-[10px] text-slate-500 italic">· 已编辑</span>

            <button 
              @click="copyToClipboard(message.content)"
              class="p-0.5 text-slate-500 dark:text-slate-400 hover:text-primary-600 transition-colors"
              title="复制内容"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
            </button>

            <!-- User-only: edit + resend -->
            <template v-if="message.role === 'user' && !selectionMode && editingIndex !== index">
              <button 
                @click="startEdit(index, message.content)"
                class="p-0.5 text-slate-500 dark:text-slate-400 hover:text-primary-600 transition-colors"
                title="编辑重发"
              >
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
              <button 
                @click="emit('resend', index)"
                class="p-0.5 text-slate-500 dark:text-slate-400 hover:text-primary-600 transition-colors"
                title="重新发送"
              >
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </button>
            </template>
          </div>
        </div>
      </div>
      
      <!-- Pending Proposals -->
      <div v-if="proposals?.length" class="px-2 space-y-2">
        <ProposalCard
          v-for="p in proposals" :key="p.id"
          :proposal="p"
          @approve="emit('proposal-approve', $event)"
          @reject="emit('proposal-reject', $event)"
        />
      </div>

      <!-- AI Thinking Loader (Only show if waiting for AI to start) -->
      <div v-if="isLoadingContent && messages[messages.length - 1]?.role === 'user'" class="w-full px-2 py-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div class="flex items-center gap-3 text-gray-400">
          <div class="flex gap-1.5">
            <span class="w-1.5 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse"></span>
            <span class="w-1.5 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse [animation-delay:200ms]"></span>
            <span class="w-1.5 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse [animation-delay:400ms]"></span>
          </div>
          <span class="text-[10px] font-bold tracking-widest uppercase">AI 正在思考中...</span>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="messages.length === 0 && !isLoadingContent" class="flex-1 flex flex-col items-center justify-center min-h-[200px] opacity-80 animate-in fade-in duration-500">
        <div class="w-12 h-12 mb-6 rounded-lg bg-slate-50 dark:bg-slate-900 flex items-center justify-center border border-slate-100 dark:border-slate-800">
          <svg class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p class="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">Ready for questions</p>
      </div>
    </div>
  </div>
</template>

<!-- All styles (markdown-body, user-message-pattern, scrollbar, citation-ref) 
     are now defined in global styles/components.css and styles/base.css -->

<style scoped>
.msg-tooltip {
  background: var(--c-bg-elevated);
  border: var(--border-width) solid var(--c-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
}
</style>
