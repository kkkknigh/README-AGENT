<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import PdfToolbar from '../pdf/PdfToolbar.vue'
import PdfViewer from '../pdf/PdfViewer.vue'
import HtmlViewer from '../html/HtmlViewer.vue'
import { usePdfStore } from '../../stores/pdf'
import { useHtmlReflowStore } from '../../stores/html-reflow'
import { useWorkbenchStore } from '../../stores/workbench'
import DocumentNotesList from './DocumentNotesList.vue'

const props = defineProps<{
  documentId: string
}>()

const emit = defineEmits<{
  openNote: [payload: { noteId: number | null; title: string; pdfId: string; isNew?: boolean }]
}>()

const pdfStore = usePdfStore()
const htmlReflowStore = useHtmlReflowStore()
const workbenchStore = useWorkbenchStore()
const htmlViewerRef = ref<any>(null)

const notesVisible = computed(() => workbenchStore.layout.notesPaneVisible)
const chatVisible = computed(() => workbenchStore.layout.auxPanelVisible)
const notesPaneHeight = computed(() => workbenchStore.layout.notesPaneHeight)

let stopResize: (() => void) | null = null

function startNotesResize(event: MouseEvent) {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = workbenchStore.layout.notesPaneHeight

  const onMove = (moveEvent: MouseEvent) => {
    const nextHeight = startHeight - (moveEvent.clientY - startY)
    workbenchStore.setNotesPaneHeight(nextHeight)
  }

  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    stopResize = null
  }

  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  stopResize = onUp
}

onBeforeUnmount(() => {
  stopResize?.()
})
</script>

<template>
  <div class="document-reader-tab">
    <div class="document-reader-tab__toolbar">
      <PdfToolbar
        :notes-visible="notesVisible"
        :chat-visible="chatVisible"
        :full-translation-visible="pdfStore.showFullTranslationSidebar"
        @toggle-notes-visibility="workbenchStore.toggleNotesPane()"
        @toggle-chat-visibility="workbenchStore.toggleAuxPanel()"
        @toggle-full-translation="pdfStore.showFullTranslationSidebar = !pdfStore.showFullTranslationSidebar"
        @start-full-translation="pdfStore.startFullPreTranslation()"
        @adjust-font-size="(delta: number) => htmlViewerRef?.adjustFontSize(delta)"
      />
    </div>

    <div class="document-reader-tab__content">
      <div class="document-reader-tab__viewer">
        <HtmlViewer v-if="htmlReflowStore.viewMode === 'html'" ref="htmlViewerRef" />
        <PdfViewer v-else />
      </div>

      <div
        v-if="notesVisible"
        class="document-reader-tab__notes-resizer"
        @mousedown="startNotesResize"
      ></div>

      <div
        v-if="notesVisible"
        class="document-reader-tab__notes"
        :style="{ height: `${notesPaneHeight}px` }"
      >
        <DocumentNotesList :pdf-id="props.documentId" @open-note="emit('openNote', $event)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.document-reader-tab {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-bg-primary);
}

.document-reader-tab__toolbar {
  background: var(--c-bg-elevated);
}

.document-reader-tab__content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
}

.document-reader-tab__viewer {
  min-height: 0;
}

.document-reader-tab__notes-resizer {
  height: 6px;
  cursor: row-resize;
  background:
    linear-gradient(
      180deg,
      transparent calc(50% - 0.5px),
      var(--c-border-light) calc(50% - 0.5px),
      var(--c-border-light) calc(50% + 0.5px),
      transparent calc(50% + 0.5px)
    );
}

.document-reader-tab__notes {
  min-height: 140px;
  max-height: 320px;
}
</style>
