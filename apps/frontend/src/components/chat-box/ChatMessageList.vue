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

const {
  tooltipState,
  renderMarkdown,
  handleMessageMouseOver,
  handleMessageMouseOut,
  handleMessageClick,
  handleTooltipEnter,
  handleTooltipLeave,
} = useMarkdownRenderer()

const messagesContainer = ref<HTMLElement | null>(null)
const editingIndex = ref<number | null>(null)
const editValue = ref('')

const thinkingExpanded = ref<Record<string, boolean>>({})
const stepsExpanded = ref<Record<string, boolean>>({})

const isThinkingExpanded = (id: string) => thinkingExpanded.value[id] ?? true
const isStepsExpanded = (id: string) => stepsExpanded.value[id] ?? true

const toggleThinking = (id: string) => {
  thinkingExpanded.value[id] = !isThinkingExpanded(id)
}

const toggleSteps = (id: string) => {
  stepsExpanded.value[id] = !isStepsExpanded(id)
}

watch(() => props.messages, (msgs) => {
  msgs.forEach((message) => {
    if (message.role === 'assistant' && message.thoughts?.length && message.content && !(message.id in thinkingExpanded.value)) {
      thinkingExpanded.value[message.id] = false
    }

    if (message.role === 'assistant' && message.steps?.length && message.content && !(message.id in stepsExpanded.value)) {
      stepsExpanded.value[message.id] = false
    }
  })
}, { deep: true })

const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

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

const formatMessageTime = (timestamp: string | number | Date) => {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const vFocus = {
  mounted: (el: HTMLElement) => el.focus(),
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
  } catch (error) {
    console.error('[Citation Import] Failed:', error)
  }
}

const getDisplayCitations = (citations: Citation[] = [], maxItems: number = 8) => {
  return citations.slice(0, maxItems)
}

defineExpose({
  scrollToBottom,
})
</script>

<template>
  <div class="h-full flex flex-col relative w-full overflow-hidden">
    <div
      v-if="tooltipState.visible && tooltipState.content"
      class="msg-tooltip fixed z-[100] w-80 p-3 transition-opacity duration-200 overflow-hidden"
      :style="{ left: Math.min(tooltipState.x - 20, 1024) + 'px', top: (tooltipState.y - 8) + 'px', transform: 'translateY(-100%)' }"
      @mouseenter="handleTooltipEnter"
      @mouseleave="handleTooltipLeave"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-[9px] font-bold text-primary-500 dark:text-gray-300 uppercase tracking-widest">
          {{ getCitationSourceLabel(tooltipState.content) }}
        </span>
        <span v-if="tooltipState.content.score" class="text-[9px] text-primary-500/90 dark:text-gray-400">
          相似度 {{ (tooltipState.content.score * 100).toFixed(0) }}%
        </span>
      </div>

      <h4 class="font-bold text-xs text-slate-800 dark:text-gray-100 mb-1.5 leading-tight">
        {{ tooltipState.content.name || '检索内容' }}
      </h4>

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

    <div ref="messagesContainer" class="flex-1 overflow-y-auto w-full px-3 pt-2 pb-3">
      <div
        v-for="(message, index) in messages"
        :key="'msg-' + index"
        class="chat-log__item group"
      >
        <div
          :class="[
            'chat-log__row',
            message.role === 'user' ? 'chat-log__row--user' : 'chat-log__row--assistant',
          ]"
        >
          <div v-if="selectionMode" class="chat-log__select">
            <input
              type="checkbox"
              :checked="selectedIds?.has(message.id)"
              @change="emit('toggle-selection', message.id)"
              class="w-3.5 h-3.5 rounded border-primary-200 dark:border-slate-700 text-primary-600 dark:text-slate-100 focus:ring-0 focus:ring-offset-0 cursor-pointer transition-colors"
              title="选择消息"
            >
          </div>

          <div
            :class="[
              'chat-log__body',
              message.role === 'user' ? 'chat-log__body--user' : 'chat-log__body--assistant',
            ]"
          >
            <div v-if="message.role === 'user'" class="chat-log__floating-meta chat-log__floating-meta--user">
              <div class="chat-log__floating-meta-inner">
                <span class="chat-log__time">{{ formatMessageTime(message.timestamp) }}</span>
                <span v-if="message.meta?.edited" class="chat-log__edited">已编辑</span>
                <button @click="copyToClipboard(message.content)" class="chat-log__icon-btn" title="复制内容">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
                </button>
                <template v-if="!selectionMode && editingIndex !== index">
                  <button @click="startEdit(index, message.content)" class="chat-log__icon-btn" title="编辑重发">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button @click="emit('resend', index)" class="chat-log__icon-btn" title="重新发送">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                </template>
              </div>
            </div>

            <div
              :class="[
                'chat-log__content',
                message.role === 'user' ? 'chat-log__content--user' : 'chat-log__content--assistant',
              ]"
            >
              <div v-if="editingIndex === index" class="animate-in fade-in zoom-in-95 duration-200">
                <textarea
                  v-model="editValue"
                  class="chat-log__editor"
                  placeholder="编辑消息..."
                  style="field-sizing: content;"
                  v-focus
                ></textarea>
                <div class="chat-log__editor-actions">
                  <button @click="cancelEdit" class="chat-log__secondary-btn">取消</button>
                  <button @click="submitEdit(index)" class="chat-log__primary-btn">确认重发</button>
                </div>
              </div>

              <template v-else>
                <div v-if="message.role === 'user'">
                  <div v-if="message.images?.length" class="flex flex-wrap gap-2 mb-2">
                    <img
                      v-for="(img, imgIdx) in message.images"
                      :key="imgIdx"
                      :src="img"
                      class="max-h-36 max-w-full rounded-lg border border-[var(--c-border-light)] object-contain"
                    />
                  </div>
                  <p class="chat-log__plain-text">{{ message.content }}</p>
                </div>

                <div v-else class="chat-log__assistant-block">
                  <div v-if="message.thoughts?.length" class="chat-log__subpanel">
                    <button @click="toggleThinking(message.id)" class="chat-log__toggle">
                      <svg
                        class="w-3 h-3 transition-transform duration-200"
                        :class="isThinkingExpanded(message.id) ? 'rotate-90' : ''"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                      <span class="font-medium tracking-wide">思考过程</span>
                      <span class="opacity-60">({{ message.thoughts.length }} 条)</span>
                    </button>
                    <div v-if="isThinkingExpanded(message.id)" class="chat-log__subpanel-body animate-in fade-in slide-in-from-top-1 duration-200">
                      <p v-for="(thought, thoughtIndex) in message.thoughts" :key="thoughtIndex" class="chat-log__subpanel-text">{{ thought }}</p>
                    </div>
                  </div>

                  <div v-if="message.steps?.length" class="chat-log__subpanel">
                    <button @click="toggleSteps(message.id)" class="chat-log__toggle">
                      <svg
                        class="w-3 h-3 transition-transform duration-200"
                        :class="isStepsExpanded(message.id) ? 'rotate-90' : ''"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                      <span class="font-medium tracking-wide">执行步骤</span>
                      <span class="opacity-60">({{ message.steps.length }})</span>
                    </button>
                    <div v-if="isStepsExpanded(message.id)" class="chat-log__subpanel-body animate-in fade-in slide-in-from-top-1 duration-200">
                      <div v-for="(step, stepIndex) in message.steps" :key="stepIndex" class="flex items-center gap-2 text-[11.5px]">
                        <span
                          :class="step.status === 'done'
                            ? 'w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0'
                            : 'w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse flex-shrink-0'"
                        />
                        <span class="chat-log__subpanel-text">{{ step.text }}</span>
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="message.content"
                    class="markdown-body prose prose-sm max-w-none dark:prose-invert prose-pre:bg-[#282c34] prose-pre:m-0 prose-headings:font-semibold prose-headings:text-gray-800 dark:prose-headings:text-gray-100 prose-a:text-primary-500 dark:prose-a:text-primary-400 prose-a:no-underline hover:prose-a:underline text-gray-700 dark:text-gray-200 text-[13px] leading-relaxed"
                    v-html="renderMarkdown(message.content)"
                    @mouseover="handleMessageMouseOver($event, message.citations || [])"
                    @mouseout="handleMessageMouseOut"
                    @click="onCitationClick($event, message.citations || [])"
                  ></div>
                  <p v-else-if="!message.steps?.length" class="text-[12px] text-[var(--c-text-muted)] italic">正在生成回复...</p>

                  <div v-if="message.citations?.length" class="flex items-center gap-x-2 gap-y-1 flex-wrap pt-0.5 pb-0.5 text-[11px]">
                    <span
                      v-for="(cite, citeIdx) in getDisplayCitations(message.citations || [])"
                      :key="cite.id || citeIdx"
                      :class="[
                        'citation-ref font-medium cursor-pointer transition-colors duration-200 whitespace-nowrap inline-flex items-center gap-1 px-1.5 py-0.5 rounded border',
                        getCitationChipClass(cite),
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

                  <div v-if="message.content" class="chat-log__floating-meta chat-log__floating-meta--assistant">
                    <button @click="copyToClipboard(message.content)" class="chat-log__icon-btn chat-log__icon-btn--assistant" title="复制内容">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div v-if="proposals?.length" class="pt-2 space-y-2">
        <ProposalCard
          v-for="proposal in proposals"
          :key="proposal.id"
          :proposal="proposal"
          @approve="emit('proposal-approve', $event)"
          @reject="emit('proposal-reject', $event)"
        />
      </div>

      <div v-if="isLoadingContent && messages[messages.length - 1]?.role === 'user'" class="w-full py-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div class="chat-log__loader">
          <div class="flex gap-1.5">
            <span class="w-1.5 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse"></span>
            <span class="w-1.5 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse [animation-delay:200ms]"></span>
            <span class="w-1.5 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse [animation-delay:400ms]"></span>
          </div>
          <span class="text-[10px] font-bold tracking-widest uppercase">AI 正在思考中...</span>
        </div>
      </div>

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

<style scoped>
.msg-tooltip {
  background: var(--c-bg-elevated);
  border: var(--border-width) solid var(--c-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
}

.chat-log__item + .chat-log__item {
  margin-top: 0.12rem;
}

.chat-log__row {
  display: flex;
  gap: 0.75rem;
  width: 100%;
  padding: 0.38rem 0;
}

.chat-log__row--user {
  justify-content: flex-end;
}

.chat-log__select {
  flex-shrink: 0;
  padding-top: 0.2rem;
}

.chat-log__body {
  min-width: 0;
  flex: 1;
}

.chat-log__body--assistant {
  width: 100%;
}

.chat-log__body--user {
  position: relative;
  width: fit-content;
  max-width: min(82%, 52rem);
  margin-left: auto;
  padding-bottom: 1.6rem;
  flex: 0 1 auto;
}

.chat-log__content {
  min-width: 0;
  color: var(--c-text-primary);
}

.chat-log__content--user {
  width: fit-content;
  max-width: 100%;
  padding: 0.42rem 0.7rem;
  background: color-mix(in srgb, var(--c-bg-secondary) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--c-border-light) 70%, transparent);
  border-radius: 0.95rem;
}

.chat-log__content--assistant {
  padding-top: 0;
}

.chat-log__plain-text {
  font-size: 0.8125rem;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--c-text-primary);
}

.chat-log__floating-meta {
  position: absolute;
  bottom: 0.12rem;
  opacity: 0;
  pointer-events: none;
  transform: translateY(0.65rem);
  transition:
    opacity var(--duration-fast) var(--ease-default),
    transform var(--duration-fast) var(--ease-default);
  z-index: 4;
}

.chat-log__body--user:hover > .chat-log__floating-meta--user,
.chat-log__body--user:focus-within > .chat-log__floating-meta--user,
.chat-log__assistant-block:hover > .chat-log__floating-meta--assistant,
.chat-log__assistant-block:focus-within > .chat-log__floating-meta--assistant {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.chat-log__floating-meta--user {
  right: 0;
}

.chat-log__floating-meta--assistant {
  left: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.75rem;
  padding: 0.14rem 0.24rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--c-bg-elevated) 94%, transparent);
  border: 1px solid color-mix(in srgb, var(--c-border-light) 88%, transparent);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(10px);
}

.chat-log__floating-meta-inner {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 1.75rem;
  padding: 0.14rem 0.24rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--c-bg-elevated) 94%, transparent);
  border: 1px solid color-mix(in srgb, var(--c-border-light) 88%, transparent);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(10px);
}

.chat-log__edited,
.chat-log__time {
  font-size: 0.6875rem;
  line-height: 1rem;
  color: var(--c-text-muted);
}

.chat-log__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 0.4rem;
  color: var(--c-text-muted);
  transition:
    background-color var(--duration-fast) var(--ease-default),
    color var(--duration-fast) var(--ease-default);
}

.chat-log__icon-btn:hover {
  background: var(--c-btn-icon-active-bg);
  color: var(--c-btn-icon-active-text);
}

.chat-log__icon-btn--assistant {
  width: 1.5rem;
  height: 1.5rem;
}

.chat-log__assistant-block {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-bottom: 1.6rem;
}

.chat-log__subpanel {
  border: 1px solid var(--c-border-light);
  background: var(--c-bg-secondary);
  border-radius: 0.7rem;
  padding: 0.55rem 0.7rem;
}

.chat-log__toggle {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  color: var(--c-text-secondary);
  transition: color var(--duration-fast) var(--ease-default);
  user-select: none;
}

.chat-log__toggle:hover {
  color: var(--c-text-primary);
}

.chat-log__subpanel-body {
  margin-top: 0.55rem;
  padding-left: 0.75rem;
  border-left: 2px solid var(--c-border);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.chat-log__subpanel-text {
  color: var(--c-text-secondary);
  line-height: 1.55;
}

.chat-log__editor {
  width: 100%;
  resize: none;
  overflow: hidden;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--c-text-primary);
}

.chat-log__editor::placeholder {
  color: var(--c-text-muted);
}

.chat-log__editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--c-border-light);
}

.chat-log__secondary-btn,
.chat-log__primary-btn {
  padding: 0.35rem 0.65rem;
  border-radius: 0.5rem;
  font-size: 0.6875rem;
  transition:
    background-color var(--duration-fast) var(--ease-default),
    color var(--duration-fast) var(--ease-default),
    border-color var(--duration-fast) var(--ease-default);
}

.chat-log__secondary-btn {
  color: var(--c-text-secondary);
  border: 1px solid var(--c-border-light);
}

.chat-log__secondary-btn:hover {
  color: var(--c-text-primary);
  background: var(--c-bg-hover);
}

.chat-log__primary-btn {
  color: white;
  background: var(--c-btn-icon-active-text);
}

.chat-log__primary-btn:hover {
  filter: brightness(1.05);
}

.chat-log__loader {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--c-text-muted);
}
</style>
