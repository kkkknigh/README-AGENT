import { computed, type MaybeRefOrGetter } from 'vue'
import { useNotesQuery } from './queries/useNoteQueries'
import type { Note } from '../api'

export interface UseNotesLookupOptions {
  pdfId: MaybeRefOrGetter<string | null>
  onNoteFound?: (note: Note, position: { x: number; y: number }) => void
}

export function useNotesLookup(options: UseNotesLookupOptions) {
  const { data: notes, isLoading: isLoadingNotes } = useNotesQuery(options.pdfId)

  // 保持与原有逻辑兼容的计算属性缓存
  const notesCache = computed(() => notes.value || [])

  /**
   * 获取点击位置的单词
   */
  function getWordAtPoint(x: number, y: number): string | null {
    let range: Range | null = null

    // Chrome, Edge, Safari
    if (typeof (document as any).caretRangeFromPoint === 'function') {
      range = (document as any).caretRangeFromPoint(x, y)
    }
    // Firefox
    else if (typeof (document as any).caretPositionFromPoint === 'function') {
      const pos = (document as any).caretPositionFromPoint(x, y)
      if (pos?.offsetNode) {
        const newRange = document.createRange()
        newRange.setStart(pos.offsetNode, pos.offset)
        newRange.setEnd(pos.offsetNode, pos.offset)
        range = newRange
      }
    }

    if (!range) return null

    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return null

    const text = node.textContent || ''
    const offset = range.startOffset

    let start = offset
    let end = offset

    // 向前找单词开始
    while (start > 0 && /[\w\u4e00-\u9fa5]/.test(text[start - 1] || '')) {
      start--
    }

    // 向后找单词结束
    while (end < text.length && /[\w\u4e00-\u9fa5]/.test(text[end] || '')) {
      end++
    }

    if (start === end) return null

    return text.slice(start, end).trim()
  }

  /**
   * 查找匹配的笔记（模糊匹配标题）
   */
  function findMatchingNote(word: string): Note | null {
    if (!word || word.length < 2) return null

    const wordLower = word.toLowerCase()
    const currentNotes = notesCache.value

    // 精确匹配优先
    for (const note of currentNotes) {
      if (note.title?.toLowerCase() === wordLower) {
        return note
      }
    }

    // 标题包含该词
    for (const note of currentNotes) {
      if (note.title?.toLowerCase().includes(wordLower)) {
        return note
      }
    }

    // 该词包含标题（标题较短时）
    for (const note of currentNotes) {
      if (note.title && note.title.length >= 2 && wordLower.includes(note.title.toLowerCase())) {
        return note
      }
    }

    return null
  }

  /**
   * 处理 Ctrl+点击
   */
  /**
   * 用 Selection API 选中点击位置所在的单词
   */
  function selectWordAtPoint(x: number, y: number): void {
    let range: Range | null = null

    if (typeof (document as any).caretRangeFromPoint === 'function') {
      range = (document as any).caretRangeFromPoint(x, y)
    } else if (typeof (document as any).caretPositionFromPoint === 'function') {
      const pos = (document as any).caretPositionFromPoint(x, y)
      if (pos?.offsetNode) {
        const newRange = document.createRange()
        newRange.setStart(pos.offsetNode, pos.offset)
        newRange.setEnd(pos.offsetNode, pos.offset)
        range = newRange
      }
    }

    if (!range) return

    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return

    const text = node.textContent || ''
    const offset = range.startOffset

    let start = offset
    let end = offset

    while (start > 0 && /[\w\u4e00-\u9fa5]/.test(text[start - 1] || '')) {
      start--
    }
    while (end < text.length && /[\w\u4e00-\u9fa5]/.test(text[end] || '')) {
      end++
    }

    if (start === end) return

    range.setStart(node, start)
    range.setEnd(node, end)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  function handleCtrlClick(event: MouseEvent): void {
    const word = getWordAtPoint(event.clientX, event.clientY)
    if (!word) return

    const matchedNote = findMatchingNote(word)
    if (matchedNote) {
      const cardX = Math.min(event.clientX + 10, window.innerWidth - 340)
      const cardY = Math.min(event.clientY + 10, window.innerHeight - 400)

      options.onNoteFound?.(matchedNote, {
        x: Math.max(0, cardX),
        y: Math.max(0, cardY)
      })
    } else {
      // 没有匹配笔记，选中该单词
      selectWordAtPoint(event.clientX, event.clientY)
    }
  }

  return {
    notesCache,
    isLoadingNotes,
    getWordAtPoint,
    findMatchingNote,
    handleCtrlClick
  }
}
