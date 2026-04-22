import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 统一添加笔记请求的载荷，高亮选区、AI 问答等场景共用 */
export interface PendingNote {
    title?: string
    content?: string
    tags?: string[]
}

export const useNotesUiStore = defineStore('notes-ui', () => {
    const pendingNote = ref<PendingNote | null>(null)

    function requestNewNote(payload: PendingNote) {
        pendingNote.value = payload
    }

    function clearPendingNote() {
        pendingNote.value = null
    }

    return {
        pendingNote,
        requestNewNote,
        clearPendingNote,
    }
})
