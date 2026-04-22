<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { usePdfStore } from '../../stores/pdf'
import { clamp } from '@vueuse/core'
import { useInternalLinkQuery, useRetryLinkMutation } from '../../composables/queries/useLinkQueries'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'

const pdfStore = usePdfStore()
const { renderMarkdown } = useMarkdownRenderer()

const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const copiedStatus = ref<'none' | 'title' | 'bibtex'>('none')
const popupRef = ref<HTMLElement | null>(null)

const isVisible = computed(() => pdfStore.internalLinkPopup.isVisible)
const position = computed(() => pdfStore.internalLinkPopup.position)
const targetParagraphId = computed(() => pdfStore.internalLinkPopup.targetParagraphId)

const { data: rawLinkData, isLoading, error } = useInternalLinkQuery(
  computed(() => pdfStore.activeReaderId),
  targetParagraphId
)

const retryMutation = useRetryLinkMutation()

const paragraphContent = computed(() => {
  if (!targetParagraphId.value) return null
  const p = pdfStore.paragraphs.find(p => p.id === targetParagraphId.value)
  return p?.content || null
})

const linkData = computed(() => {
  if (!rawLinkData.value) return null
  const data = { ...rawLinkData.value }

  if (data.valid !== 1 && (!data.url || data.url.length < 5)) {
    const query = data.title || paragraphContent.value?.trim()?.slice(0, 100) || ''
    if (query) {
      data.url = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`
    }
  }
  return data
})

const isValidData = computed(() => linkData.value?.valid === 1)

const citationCountFormatted = computed(() => {
  const count = linkData.value?.citationCount
  if (count === undefined || count === null) return null
  if (count >= 1000) return (count / 1000).toFixed(1) + 'k'
  return count.toString()
})

const isAcademicUrl = computed(() => {
  const url = linkData.value?.url?.toLowerCase() || ''
  return url.includes('arxiv.org') || url.includes('doi.org') || url.includes('semanticscholar.org') || url.includes('ieeexplore')
})

function handleClickOutside(e: MouseEvent) {
  if (popupRef.value && !popupRef.value.contains(e.target as Node)) {
    closePopup()
  }
}

watch(isVisible, (visible) => {
  if (visible) {
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)
  } else {
    isDragging.value = false
    copiedStatus.value = 'none'
    document.removeEventListener('mousedown', handleClickOutside)
  }
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})

function startDrag(e: MouseEvent) {
  isDragging.value = true
  dragOffset.value = {
    x: e.clientX - position.value.x,
    y: e.clientY - position.value.y,
  }
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
  e.preventDefault()
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return
  const newX = e.clientX - dragOffset.value.x
  const newY = e.clientY - dragOffset.value.y
  const clampedX = clamp(newX, 10, window.innerWidth - 430)
  const clampedY = clamp(newY, 10, window.innerHeight - 300)
  pdfStore.updateInternalLinkPopupPosition({ x: clampedX, y: clampedY })
}

function stopDrag() {
  isDragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

function closePopup() {
  pdfStore.closeInternalLinkPopup()
}

async function handleRetry() {
  if (!pdfStore.activeReaderId || !targetParagraphId.value) return
  await retryMutation.mutateAsync({
    pdfId: pdfStore.activeReaderId,
    paragraphId: targetParagraphId.value,
  })
}

async function copyToClipboard(text: string, type: 'title' | 'bibtex') {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedStatus.value = type
    setTimeout(() => {
      copiedStatus.value = 'none'
    }, 2000)
  } catch (err) {
    console.error('Copy failed:', err)
  }
}

function generateBibTeX() {
  if (!linkData.value) return ''
  const firstAuthor = linkData.value.authors?.[0]?.split(' ')?.pop() || 'ref'
  const year = linkData.value.published_date || new Date().getFullYear()
  return `@article{${firstAuthor.toLowerCase()}${year},
  title={${linkData.value.title}},
  author={${linkData.value.authors?.join(' and ')}},
  journal={${linkData.value.venue || 'Unknown'}},
  year={${year}}
}`
}

function openUrl() {
  if (!linkData.value?.url) return
  window.open(linkData.value.url, '_blank')
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="popupRef"
      v-if="isVisible"
      class="internal-link-popup popup-surface popup-surface--floating fixed z-[9999] w-[420px] overflow-hidden select-none"
      :style="{ left: position.x + 'px', top: position.y + 'px' }"
    >
      <div class="popup-header cursor-move" @mousedown="startDrag">
        <div class="flex items-center gap-2">
          <div class="size-1.5 rounded-full bg-primary-500"></div>
          <span class="popup-title uppercase tracking-widest text-gray-500 dark:text-gray-400">Reference Info</span>
        </div>
        <div class="flex items-center gap-1">
          <button
            @click="handleRetry"
            :disabled="isLoading || retryMutation.isPending.value"
            class="popup-icon-btn group"
            title="Retry Search"
          >
            <svg
              class="h-3.5 w-3.5 text-gray-400 transition-colors group-hover:text-primary-500"
              :class="{ 'animate-spin': isLoading || retryMutation.isPending.value }"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          <button @click="closePopup" class="popup-icon-btn group">
            <svg class="h-3.5 w-3.5 text-gray-400 transition-colors group-hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div class="popup-body">
        <div v-if="isLoading || retryMutation.isPending.value">
          <div class="popup-card popup-scroll relative mb-4 max-h-40 overflow-y-auto p-3.5 custom-scrollbar">
            <div
              class="popup-text leading-relaxed markdown-body prose prose-sm max-w-none"
              v-html="renderMarkdown(paragraphContent || '')"
            ></div>
          </div>
          <div class="flex items-center justify-center gap-2 py-2">
            <div class="popup-loading-spinner size-4"></div>
            <p class="popup-text-muted animate-pulse text-xs font-medium uppercase tracking-wider">Searching Knowledge Bases...</p>
          </div>
        </div>

        <div v-else-if="error" class="popup-card popup-card--danger p-4 text-center">
          <p class="popup-text-error font-medium">{{ error }}</p>
          <button @click="handleRetry" class="popup-link mt-2">Try Again</button>
        </div>

        <div v-else-if="linkData">
          <template v-if="isValidData">
            <h3
              class="internal-link-title popup-title mb-2 cursor-pointer leading-snug transition-colors hover:text-primary-500 dark:hover:text-primary-400 line-clamp-2"
              @click="openUrl"
            >
              {{ linkData.title }}
            </h3>

            <div class="mb-3 flex items-center gap-1.5">
              <svg class="h-3 w-3 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <p class="popup-text-muted line-clamp-1 font-medium">
                {{ linkData.authors?.join(', ') || 'Anonymous Authors' }}
              </p>
            </div>

            <div class="mb-4 flex flex-wrap gap-1.5">
              <span v-if="linkData.published_date" class="popup-badge popup-badge--blue">
                {{ linkData.published_date }}
              </span>
              <span v-if="linkData.venue" class="popup-badge popup-badge--purple max-w-[180px] truncate">
                {{ linkData.venue }}
              </span>
              <span v-if="citationCountFormatted" class="popup-badge popup-badge--orange">
                <svg class="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/></svg>
                Cited {{ citationCountFormatted }}
              </span>
            </div>

            <div class="popup-card popup-scroll relative mb-4 max-h-32 overflow-y-auto p-3 custom-scrollbar">
              <div
                class="popup-text font-medium leading-relaxed markdown-body prose prose-sm max-w-none"
                v-html="renderMarkdown(linkData.snippet || 'No abstract available for this work.')"
              ></div>
            </div>
          </template>

          <template v-else>
            <div class="mb-4">
              <div class="mb-2 flex items-center gap-2">
                <span class="popup-badge popup-badge--orange">Full record not found</span>
              </div>
              <div class="popup-card popup-scroll max-h-40 overflow-y-auto border-dashed border-gray-300 p-3.5 custom-scrollbar dark:border-white/10">
                <div
                  class="popup-text-muted italic leading-relaxed markdown-body prose prose-sm max-w-none"
                  v-html="renderMarkdown(paragraphContent || linkData.snippet || 'The exact reference data could not be retrieved. Displaying captured context above.')"
                ></div>
              </div>
            </div>
          </template>

          <div class="flex items-center justify-between border-t border-black/5 pt-3 dark:border-white/5">
            <div class="flex gap-2">
              <button
                @click="copyToClipboard(linkData.title, 'title')"
                class="popup-button icon-action-btn"
                :class="{ copied: copiedStatus === 'title' }"
                title="Copy Title"
              >
                <svg v-if="copiedStatus !== 'title'" class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 112-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
              </button>

              <button
                @click="copyToClipboard(generateBibTeX(), 'bibtex')"
                class="popup-button icon-action-btn"
                :class="{ copied: copiedStatus === 'bibtex' }"
                title="Copy BibTeX"
              >
                <span v-if="copiedStatus !== 'bibtex'" class="popup-label internal-link-bib-label">BIB</span>
                <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
              </button>
            </div>

            <button @click="openUrl" class="popup-button popup-button--accent flex items-center gap-1.5">
              <span class="popup-label font-bold uppercase tracking-wide">{{ isAcademicUrl ? 'Direct Access' : 'External Search' }}</span>
              <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </div>

        <div v-else class="popup-text-muted py-10 text-center italic">
          No record found for this reference.
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.internal-link-popup {
  animation: pop-in 0.25s var(--ease-out);
}

.internal-link-title {
  font-size: calc(var(--popup-title-size) + 1px);
}

.icon-action-btn {
  height: 32px;
  padding: 0 var(--space-2);
  color: var(--c-text-muted);
  border-color: transparent;
}

.icon-action-btn:hover:not(:disabled) {
  color: var(--c-accent);
  border-color: var(--c-accent-border);
}

.icon-action-btn.copied {
  color: var(--c-success);
  background: var(--c-success-bg);
  border-color: var(--c-success-border);
}

.custom-scrollbar::-webkit-scrollbar { width: 3px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: var(--c-scrollbar-thumb); border-radius: 2px; }

.internal-link-bib-label {
  font-size: var(--popup-badge-size);
}
/* line-clamp-1, line-clamp-2 are now in global base.css */
</style>
