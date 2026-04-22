<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { useI18n } from 'vue-i18n'
import { useLibraryStore } from '../../stores/library'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'
import { useRoadmapQuery } from '../../composables/queries/useAiQueries'
import type { RoadmapNodeData } from '../../types'

const { renderMarkdown } = useMarkdownRenderer()
const { t } = useI18n()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const libraryStore = useLibraryStore()
const { onNodeClick, fitView } = useVueFlow()

const { data: roadmap, isLoading: isInitialLoading, isFetching: isFetchingRoadmap, refetch: refetchRoadmap } = useRoadmapQuery(
  computed(() => libraryStore.currentDocumentId)
)

const isLoadingRoadmap = computed(() => isInitialLoading.value && !roadmap.value)
const isRefreshingRoadmap = computed(() => isFetchingRoadmap.value && !!roadmap.value)
const hasRoadmapData = computed(() => !!roadmap.value && roadmap.value.nodes.length > 0)
const emptyMessage = computed(() => {
  if (roadmap.value?.source === 'enrichment_missing') {
    return t('pdfToolbar.roadmapEmptyEnrichment')
  }
  return t('pdfToolbar.roadmapEmpty')
})

const selectedNode = ref<RoadmapNodeData | null>(null)
const isSelectedPaper = computed(() => selectedNode.value?.kind === 'paper' || selectedNode.value?.kind === 'center')
const isSelectedKeyword = computed(() => selectedNode.value?.kind === 'keyword')
const selectedPaperAuthors = computed(() => (selectedNode.value?.authors || []).join(' / '))

const baseWindowWidth = 560
const baseWindowHeight = 420
const minWindowWidth = 420
const minWindowHeight = 320

const windowWidth = ref(baseWindowWidth)
const windowHeight = ref(baseWindowHeight)
const windowRef = ref<HTMLElement | null>(null)
const isCompactWidth = computed(() => windowWidth.value < 640)
const isCompactHeight = computed(() => windowHeight.value < 460)
const isCompact = computed(() => isCompactWidth.value || isCompactHeight.value)
const detailPanelClass = computed(() => {
  if (isCompactHeight.value) return 'top-[48%]'
  if (isCompactWidth.value) return 'top-[56%]'
  return 'top-[62%]'
})

const dragState = ref({
  isDragging: false,
  startX: 0,
  startY: 0,
  initialLeft: 0,
  initialTop: 0,
})

const resizeState = ref({
  isResizing: false,
  direction: '' as '' | 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  startX: 0,
  startY: 0,
  initialWidth: 0,
  initialHeight: 0,
  initialLeft: 0,
  initialTop: 0,
})

const position = ref({ x: Math.max(24, window.innerWidth - baseWindowWidth - 48), y: 120 })
let resizeObserver: ResizeObserver | null = null
let fitTimer: ReturnType<typeof setTimeout> | null = null

const resizeHandles: Array<{ key: NonNullable<typeof resizeState.value.direction>; className: string }> = [
  { key: 'top', className: 'resize-handle resize-handle-top' },
  { key: 'right', className: 'resize-handle resize-handle-right' },
  { key: 'bottom', className: 'resize-handle resize-handle-bottom' },
  { key: 'left', className: 'resize-handle resize-handle-left' },
  { key: 'top-left', className: 'resize-handle resize-handle-corner resize-handle-top-left' },
  { key: 'top-right', className: 'resize-handle resize-handle-corner resize-handle-top-right' },
  { key: 'bottom-left', className: 'resize-handle resize-handle-corner resize-handle-bottom-left' },
  { key: 'bottom-right', className: 'resize-handle resize-handle-corner resize-handle-bottom-right' },
]

const formatDirectionLabel = (direction?: 'references' | 'cited_by') => {
  if (direction === 'references') return t('pdfToolbar.roadmapReferences')
  if (direction === 'cited_by') return t('pdfToolbar.roadmapCitedBy')
  return ''
}

function scheduleFitView(delay: number = 100) {
  if (!hasRoadmapData.value) return
  if (fitTimer) {
    clearTimeout(fitTimer)
  }
  fitTimer = setTimeout(() => {
    fitView({ padding: isCompact.value ? 0.14 : 0.2, duration: 180 })
  }, delay)
}

function startDrag(event: MouseEvent) {
  if (!windowRef.value || resizeState.value.isResizing) return

  dragState.value.isDragging = true
  dragState.value.startX = event.clientX
  dragState.value.startY = event.clientY

  const rect = windowRef.value.getBoundingClientRect()
  dragState.value.initialLeft = rect.left
  dragState.value.initialTop = rect.top

  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}

function onDrag(event: MouseEvent) {
  if (!dragState.value.isDragging) return

  const deltaX = event.clientX - dragState.value.startX
  const deltaY = event.clientY - dragState.value.startY

  position.value.x = dragState.value.initialLeft + deltaX
  position.value.y = dragState.value.initialTop + deltaY
}

function stopDrag() {
  dragState.value.isDragging = false
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}

function startResize(direction: NonNullable<typeof resizeState.value.direction>, event: MouseEvent) {
  if (!windowRef.value) return

  event.preventDefault()
  event.stopPropagation()

  const rect = windowRef.value.getBoundingClientRect()
  resizeState.value.isResizing = true
  resizeState.value.direction = direction
  resizeState.value.startX = event.clientX
  resizeState.value.startY = event.clientY
  resizeState.value.initialWidth = rect.width
  resizeState.value.initialHeight = rect.height
  resizeState.value.initialLeft = rect.left
  resizeState.value.initialTop = rect.top

  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
}

function onResize(event: MouseEvent) {
  if (!resizeState.value.isResizing) return

  const deltaX = event.clientX - resizeState.value.startX
  const deltaY = event.clientY - resizeState.value.startY
  const direction = resizeState.value.direction

  let nextWidth = resizeState.value.initialWidth
  let nextHeight = resizeState.value.initialHeight
  let nextX = resizeState.value.initialLeft
  let nextY = resizeState.value.initialTop

  if (direction.includes('right')) {
    nextWidth = Math.max(minWindowWidth, resizeState.value.initialWidth + deltaX)
  }
  if (direction.includes('bottom')) {
    nextHeight = Math.max(minWindowHeight, resizeState.value.initialHeight + deltaY)
  }
  if (direction.includes('left')) {
    const rawWidth = resizeState.value.initialWidth - deltaX
    nextWidth = Math.max(minWindowWidth, rawWidth)
    nextX = resizeState.value.initialLeft + (resizeState.value.initialWidth - nextWidth)
  }
  if (direction.includes('top')) {
    const rawHeight = resizeState.value.initialHeight - deltaY
    nextHeight = Math.max(minWindowHeight, rawHeight)
    nextY = resizeState.value.initialTop + (resizeState.value.initialHeight - nextHeight)
  }

  windowWidth.value = Math.round(nextWidth)
  windowHeight.value = Math.round(nextHeight)
  position.value.x = Math.max(0, Math.round(nextX))
  position.value.y = Math.max(0, Math.round(nextY))
}

function stopResize() {
  resizeState.value.isResizing = false
  resizeState.value.direction = ''
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
  scheduleFitView(40)
}

watch(roadmap, (newVal) => {
  if (newVal) {
    scheduleFitView(100)
  }
})

watch(() => libraryStore.currentDocumentId, (newId) => {
  if (newId) {
    selectedNode.value = null
  }
})

onNodeClick((event) => {
  selectedNode.value = event.node.data as RoadmapNodeData
})

function exportRoadmap() {
  if (!roadmap.value) return
  const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(roadmap.value, null, 2))}`
  const downloadAnchorNode = document.createElement('a')
  downloadAnchorNode.setAttribute('href', dataStr)
  downloadAnchorNode.setAttribute('download', 'citation-graph.json')
  document.body.appendChild(downloadAnchorNode)
  downloadAnchorNode.click()
  downloadAnchorNode.remove()
}

async function regenerateRoadmap() {
  if (!libraryStore.currentDocumentId || isFetchingRoadmap.value) return
  selectedNode.value = null
  await refetchRoadmap()
  scheduleFitView(120)
}

function closeDetail() {
  selectedNode.value = null
}

onMounted(() => {
  if (windowRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      scheduleFitView(80)
    })
    resizeObserver.observe(windowRef.value)
  }
  if (roadmap.value) {
    scheduleFitView(100)
  }
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
  resizeObserver?.disconnect()
  if (fitTimer) {
    clearTimeout(fitTimer)
  }
})
</script>

<template>
  <div
    ref="windowRef"
    class="fixed z-[100] bg-white dark:bg-[#1e1e1e] rounded-lg shadow-2xl border border-gray-300 dark:border-gray-700 flex flex-col overflow-hidden"
    :class="{
      'roadmap-compact': isCompact,
      'roadmap-compact-width': isCompactWidth,
      'roadmap-compact-height': isCompactHeight,
    }"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
      width: `${windowWidth}px`,
      height: `${windowHeight}px`
    }"
  >
    <div
      class="h-9 bg-gray-100 dark:bg-[#2d2d30] border-b border-gray-200 dark:border-gray-700 flex justify-between items-center px-3 select-none"
      :class="dragState.isDragging ? 'cursor-grabbing' : 'cursor-grab'"
      @mousedown="startDrag"
    >
      <div class="flex items-center gap-2">
        <svg class="w-4 h-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
        <span class="text-xs font-bold text-gray-700 dark:text-gray-300">{{ t('pdfToolbar.roadmap') }}</span>
      </div>

      <div class="flex items-center gap-2" @mousedown.stop>
        <button
          @click="regenerateRoadmap"
          class="ui-btn ui-btn--compact text-[10px] px-1.5 py-0.5"
          :title="t('pdfToolbar.roadmapRegenerate')"
          :disabled="isFetchingRoadmap"
        >
          {{ isFetchingRoadmap ? t('pdfToolbar.roadmapRegeneratingShort') : t('pdfToolbar.roadmapRegenerateShort') }}
        </button>
        <button
          @click="exportRoadmap"
          class="ui-btn ui-btn--compact text-[10px] px-1.5 py-0.5"
          :title="t('pdfToolbar.roadmapExport')"
        >
          {{ t('pdfToolbar.roadmapExportShort') }}
        </button>
        <button
          @click="$emit('close')"
          class="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors p-0.5"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>

    <div class="flex-1 relative w-full h-full bg-gray-50 dark:bg-[#252526] overflow-hidden">
      <div v-if="isLoadingRoadmap" class="absolute inset-0 flex flex-col items-center justify-center bg-white/80 dark:bg-[#1e1e1e]/80 z-10">
        <div class="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full mb-2"></div>
        <span class="text-xs text-gray-500 dark:text-gray-400">{{ t('pdfToolbar.roadmapGenerating') }}</span>
      </div>

      <div v-else-if="isRefreshingRoadmap" class="absolute top-2 right-2 z-10 rounded bg-white/85 px-2 py-1 text-[10px] text-gray-500 shadow dark:bg-[#1e1e1e]/85 dark:text-gray-300">
        {{ t('pdfToolbar.roadmapRegenerating') }}
      </div>

      <VueFlow
        v-if="hasRoadmapData && roadmap"
        :nodes="roadmap.nodes"
        :edges="roadmap.edges"
        class="basicflow w-full h-full"
        :default-viewport="{ zoom: 0.9 }"
        :min-zoom="0.35"
        :max-zoom="1.8"
        fit-view-on-init
      >
        <Background pattern-color="#ddd" :gap="12" :size="1" />
        <Controls position="bottom-left" class="scale-75 origin-bottom-left" />
      </VueFlow>

      <div v-else-if="!isLoadingRoadmap" class="absolute inset-0 flex items-center justify-center text-center p-4">
        <p class="text-xs text-gray-400 dark:text-gray-500">{{ emptyMessage }}</p>
      </div>

      <div
        v-if="selectedNode"
        class="absolute inset-x-0 bottom-0 bg-white/95 dark:bg-[#2d2d30]/95 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] p-3 overflow-y-auto z-20"
        :class="detailPanelClass"
      >
        <div class="flex justify-between items-start mb-1 sticky top-0 bg-white/95 dark:bg-[#2d2d30]/95 pb-1">
          <h4 class="font-bold text-gray-800 dark:text-gray-200 text-xs truncate pr-2">{{ selectedNode.label }}</h4>
          <button @click="closeDetail" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <p class="text-xs text-gray-600 dark:text-gray-400 mb-2 leading-relaxed markdown-body prose prose-sm max-w-none dark:prose-invert" v-html="renderMarkdown(selectedNode.description)"></p>

        <div v-if="isSelectedPaper" class="space-y-2 text-[11px] text-gray-600 dark:text-gray-300">
          <div v-if="selectedNode?.year || selectedNode?.citationCount != null || selectedNode?.direction" class="flex flex-wrap gap-1.5">
            <span v-if="selectedNode?.year" class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10">Y{{ selectedNode.year }}</span>
            <span v-if="selectedNode?.citationCount != null" class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10">C{{ selectedNode.citationCount }}</span>
            <span v-if="selectedNode?.direction" class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10">{{ formatDirectionLabel(selectedNode.direction) }}</span>
          </div>
          <p v-if="selectedNode?.venue" class="break-words">{{ selectedNode.venue }}</p>
          <p v-if="selectedPaperAuthors" class="break-words">{{ selectedPaperAuthors }}</p>
          <a
            v-if="selectedNode?.link"
            :href="selectedNode.link"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline"
          >
            {{ t('pdfToolbar.roadmapOpenPaper') }}
          </a>
        </div>

        <div v-else-if="isSelectedKeyword" class="space-y-2 text-[11px] text-gray-600 dark:text-gray-300">
          <div v-if="selectedNode?.direction" class="flex flex-wrap gap-1.5">
            <span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10">{{ formatDirectionLabel(selectedNode.direction) }}</span>
          </div>
        </div>

        <div v-else-if="selectedNode.papers && selectedNode.papers.length > 0">
          <ul class="space-y-1.5">
            <li v-for="(paper, idx) in selectedNode.papers" :key="idx" class="text-xs border-l-2 border-primary-300 dark:border-primary-600 pl-2">
              <a :href="paper.link" target="_blank" rel="noopener noreferrer" class="font-medium text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 hover:underline block truncate" :title="paper.title">
                {{ paper.title }}
              </a>
              <div class="mt-1 flex flex-wrap gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                <span v-if="paper.year">{{ paper.year }}</span>
                <span v-if="paper.citationCount !== undefined">C{{ paper.citationCount }}</span>
                <span v-if="paper.direction">{{ formatDirectionLabel(paper.direction) }}</span>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div
      v-for="handle in resizeHandles"
      :key="handle.key"
      :class="handle.className"
      @mousedown="startResize(handle.key, $event)"
    />
  </div>
</template>

<style scoped>
:deep(.vue-flow__node) {
  font-size: 11px;
  line-height: 1.45;
  padding: 10px 12px;
  border-radius: 10px;
  width: auto;
  max-width: 220px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.24);
  text-align: center;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06);
  color: #334155;
}

:deep(.vue-flow__node.node-center) {
  width: 18px;
  min-width: 18px;
  max-width: 18px;
  height: 18px;
  min-height: 18px;
  padding: 0;
  border-radius: 999px;
  border-color: rgba(37, 99, 235, 0.72);
  background: radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.98) 0%, rgba(96, 165, 250, 0.95) 45%, rgba(37, 99, 235, 1) 100%);
  box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.14), 0 8px 18px rgba(37, 99, 235, 0.2);
  font-size: 0;
  line-height: 0;
  color: transparent;
  overflow: hidden;
}

:deep(.vue-flow__node.node-keyword) {
  max-width: 180px;
  border-radius: 999px;
  padding: 8px 14px;
  background: rgba(248, 250, 252, 0.98);
  border-color: rgba(148, 163, 184, 0.32);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
  color: #475569;
  font-weight: 600;
}

:deep(.vue-flow__node.node-paper) {
  max-width: 240px;
  text-align: left;
  border-radius: 14px;
  padding: 12px 14px;
}

.roadmap-compact-width :deep(.vue-flow__node) {
  max-width: 180px;
  font-size: 10px;
  padding: 8px 10px;
}

.roadmap-compact-width :deep(.vue-flow__node.node-center) {
  width: 14px;
  min-width: 14px;
  max-width: 14px;
  height: 14px;
  min-height: 14px;
  padding: 0;
}

.roadmap-compact-width :deep(.vue-flow__node.node-keyword) {
  max-width: 140px;
  padding: 7px 12px;
}

.roadmap-compact-width :deep(.vue-flow__node.node-paper) {
  max-width: 190px;
  padding: 10px 12px;
}

.roadmap-compact-height :deep(.vue-flow__controls) {
  transform: scale(0.68);
  transform-origin: bottom left;
}

:deep(.vue-flow__node.selected) {
  border-color: rgba(59, 130, 246, 0.7);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.28), 0 12px 28px rgba(59, 130, 246, 0.14);
}

:global(.dark) :deep(.vue-flow__node) {
  background: var(--c-bg-tertiary);
  border-color: var(--c-border-input);
  color: var(--c-text-primary);
}

:global(.dark) :deep(.vue-flow__node.node-center) {
  background: radial-gradient(circle at 35% 35%, rgba(191, 219, 254, 0.96) 0%, rgba(59, 130, 246, 0.95) 42%, rgba(30, 64, 175, 1) 100%);
  border-color: rgba(147, 197, 253, 0.9);
  box-shadow: 0 0 0 5px rgba(59, 130, 246, 0.18), 0 8px 18px rgba(2, 6, 23, 0.42);
  color: transparent;
}

:global(.dark) :deep(.vue-flow__node.node-keyword) {
  background: rgba(30, 41, 59, 0.95);
  border-color: rgba(148, 163, 184, 0.28);
  color: #cbd5e1;
}

:global(.dark) :deep(.vue-flow__node.selected) {
  border-color: var(--c-accent-hover);
  box-shadow: 0 0 0 1px rgba(91, 142, 201, 0.5);
}

:global(.dark) :deep(.vue-flow__edge-path) {
  stroke: rgba(148, 163, 184, 0.75);
}

:deep(.vue-flow__edge-path) {
  stroke: rgba(148, 163, 184, 0.78);
  stroke-width: 1.8;
}

:deep(.vue-flow__edge.center-edge .vue-flow__edge-path) {
  stroke: rgba(37, 99, 235, 0.9);
  stroke-width: 2.4;
}

:deep(.vue-flow__edge.keyword-edge .vue-flow__edge-path) {
  stroke: rgba(148, 163, 184, 0.72);
  stroke-width: 1.4;
  stroke-dasharray: 5 4;
}

:global(.dark) :deep(.vue-flow__edge.center-edge .vue-flow__edge-path) {
  stroke: rgba(96, 165, 250, 0.88);
}

:global(.dark) :deep(.vue-flow__edge.keyword-edge .vue-flow__edge-path) {
  stroke: rgba(148, 163, 184, 0.55);
}

:global(.dark) :deep(.vue-flow__controls) {
  background: var(--c-bg-tertiary);
  border-color: var(--c-border-input);
}

:global(.dark) :deep(.vue-flow__controls-button) {
  background: var(--c-bg-hover);
  border-color: var(--c-border-input);
  fill: var(--c-text-primary);
}

:global(.dark) :deep(.vue-flow__controls-button:hover) {
  background: var(--c-bg-tertiary);
}

.resize-handle {
  position: absolute;
  z-index: 30;
}

.resize-handle-top,
.resize-handle-bottom {
  left: 12px;
  right: 12px;
  height: 8px;
}

.resize-handle-left,
.resize-handle-right {
  top: 12px;
  bottom: 12px;
  width: 8px;
}

.resize-handle-top {
  top: -4px;
  cursor: ns-resize;
}

.resize-handle-right {
  right: -4px;
  cursor: ew-resize;
}

.resize-handle-bottom {
  bottom: -4px;
  cursor: ns-resize;
}

.resize-handle-left {
  left: -4px;
  cursor: ew-resize;
}

.resize-handle-corner {
  width: 14px;
  height: 14px;
}

.resize-handle-top-left {
  top: -6px;
  left: -6px;
  cursor: nwse-resize;
}

.resize-handle-top-right {
  top: -6px;
  right: -6px;
  cursor: nesw-resize;
}

.resize-handle-bottom-left {
  bottom: -6px;
  left: -6px;
  cursor: nesw-resize;
}

.resize-handle-bottom-right {
  right: -6px;
  bottom: -6px;
  cursor: nwse-resize;
}
</style>
