<script setup lang="ts">
import { computed } from 'vue'
import { useNotesQuery } from '../../composables/queries/useNoteQueries'

const props = defineProps<{
  pdfId: string
}>()

const emit = defineEmits<{
  openNote: [payload: { noteId: number | null; title: string; pdfId: string; isNew?: boolean }]
}>()

const { data } = useNotesQuery(() => props.pdfId)
const notes = computed(() => data.value || [])
</script>

<template>
  <div class="document-notes">
    <div class="document-notes__header">
      <div>
        <div class="document-notes__eyebrow">Notes</div>
        <div class="document-notes__title">{{ notes.length }} linked notes</div>
      </div>
      <button class="document-notes__create" @click="emit('openNote', { noteId: null, title: 'Untitled Note', pdfId, isNew: true })">
        New Note
      </button>
    </div>

    <div v-if="notes.length" class="document-notes__list">
      <button
        v-for="note in notes"
        :key="note.id"
        class="document-notes__item"
        @click="emit('openNote', { noteId: note.id, title: note.title || 'Untitled Note', pdfId })"
      >
        <strong>{{ note.title || 'Untitled Note' }}</strong>
        <span>{{ note.content.slice(0, 100) || 'Empty note' }}</span>
      </button>
    </div>

    <div v-else class="document-notes__empty">
      No notes for this document.
    </div>
  </div>
</template>

<style scoped>
.document-notes {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-bg-secondary);
  border-top: var(--border-width) solid var(--c-border-light);
}

.document-notes__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: var(--border-width) solid var(--c-border-light);
}

.document-notes__eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--c-text-muted);
}

.document-notes__title {
  font-size: var(--text-sm);
  color: var(--c-text-secondary);
}

.document-notes__create {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--c-accent-bg);
  color: var(--c-accent);
  border: var(--border-width) solid var(--c-accent-border);
  font-size: 12px;
  font-weight: 600;
}

.document-notes__list {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  overflow-x: auto;
}

.document-notes__item {
  min-width: 220px;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  text-align: left;
  border-radius: 12px;
  background: var(--c-bg-elevated);
  border: var(--border-width) solid var(--c-border-light);
}

.document-notes__item strong {
  color: var(--c-text-primary);
  font-size: 13px;
}

.document-notes__item span {
  color: var(--c-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.document-notes__empty {
  padding: 16px;
  color: var(--c-text-muted);
  font-size: 12px;
}
</style>

