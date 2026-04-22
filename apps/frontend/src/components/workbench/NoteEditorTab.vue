<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { Note } from '../../types'
import { notesApi } from '../../api'
import { useNotesQuery } from '../../composables/queries/useNoteQueries'
import NoteEditor from '../notes/NoteEditor.vue'

const props = defineProps<{
  pdfId: string
  noteId: number | null
  title: string
  isNew?: boolean
}>()

const emit = defineEmits<{
  titleChange: [title: string]
  deleted: []
  saved: [payload: { title: string; noteId: number | null }]
}>()

const queryClient = useQueryClient()
const { data } = useNotesQuery(() => props.pdfId)
const currentNote = computed<Note | null>(() => (data.value || []).find((item) => item.id === props.noteId) ?? null)

const title = ref(props.title || '')
const content = ref('')
const saving = ref(false)
const deleting = ref(false)

watch(() => props.title, (value) => {
  title.value = value || ''
}, { immediate: true })

watch(currentNote, (value) => {
  content.value = value?.content || ''
  if (value?.title) {
    title.value = value.title
  }
}, { immediate: true })

watch(title, (value) => {
  emit('titleChange', value || 'Untitled Note')
})

async function save() {
  saving.value = true
  try {
    if (props.noteId == null) {
      const response = await notesApi.createNote({
        pdfId: props.pdfId,
        title: title.value || 'Untitled Note',
        content: content.value,
        tags: [],
      })
      emit('saved', { title: title.value || 'Untitled Note', noteId: response.id ?? null })
    } else {
      await notesApi.updateNote(props.noteId, {
        title: title.value || 'Untitled Note',
        content: content.value,
        tags: currentNote.value?.tags || [],
      })
      emit('saved', { title: title.value || 'Untitled Note', noteId: props.noteId })
    }
    await queryClient.invalidateQueries({ queryKey: ['notes', props.pdfId] })
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (props.noteId == null) {
    emit('deleted')
    return
  }
  deleting.value = true
  try {
    await notesApi.deleteNote(props.noteId)
    await queryClient.invalidateQueries({ queryKey: ['notes', props.pdfId] })
    emit('deleted')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="note-tab">
    <div class="note-tab__header">
      <input v-model="title" class="note-tab__title" placeholder="Untitled Note" />
      <div class="note-tab__actions">
        <button class="note-tab__btn note-tab__btn--danger" :disabled="deleting" @click="remove">
          {{ deleting ? 'Deleting...' : 'Delete' }}
        </button>
        <button class="note-tab__btn note-tab__btn--primary" :disabled="saving" @click="save">
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>
    <div class="note-tab__body">
      <NoteEditor v-model="content" :editable="true" />
    </div>
  </div>
</template>

<style scoped>
.note-tab {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-bg-primary);
}

.note-tab__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: var(--border-width) solid var(--c-border-light);
  background: var(--c-bg-elevated);
}

.note-tab__title {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--c-text-primary);
  background: transparent;
  border: none;
  outline: none;
}

.note-tab__actions {
  display: flex;
  gap: 8px;
}

.note-tab__btn {
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}

.note-tab__btn--primary {
  background: var(--c-accent);
  color: white;
}

.note-tab__btn--danger {
  background: var(--c-error-bg);
  color: var(--c-error);
}

.note-tab__body {
  flex: 1;
  overflow: auto;
  padding: 16px;
}
</style>

