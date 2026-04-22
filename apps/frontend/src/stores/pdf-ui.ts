import { ref } from 'vue'

/** PDF 内部链接目标坐标 */
export type DestinationCoords = {
    page: number
    x: number | null
    y: number | null
    zoom: number | null
    type: string
}

export function usePdfUiState() {
    // ---------------------- 笔记预览卡片 ----------------------
    const notePreviewCard = ref<{
        isVisible: boolean
        note: { id: number | string; title: string; content: string } | null
        position: { x: number; y: number }
    }>({
        isVisible: false,
        note: null,
        position: { x: 0, y: 0 }
    })

    function openNotePreviewCard(note: { id: number | string; title: string; content: string }, position: { x: number; y: number }) {
        notePreviewCard.value = { isVisible: true, note, position }
    }

    function closeNotePreviewCard() {
        notePreviewCard.value = { isVisible: false, note: null, position: { x: 0, y: 0 } }
    }

    function updateNotePreviewPosition(position: { x: number; y: number }) {
        notePreviewCard.value.position = position
    }

    // ---------------------- 内部链接弹窗 ----------------------
    const internalLinkPopup = ref<{
        isVisible: boolean
        destCoords: DestinationCoords | null
        position: { x: number; y: number }
        targetParagraphId: string | null
    }>({
        isVisible: false,
        destCoords: null,
        position: { x: 0, y: 0 },
        targetParagraphId: null
    })

    function openInternalLinkPopup(destCoords: DestinationCoords, position: { x: number; y: number }, targetParagraphId: string | null) {
        internalLinkPopup.value = {
            isVisible: true,
            destCoords,
            position,
            targetParagraphId
        }
    }

    function closeInternalLinkPopup() {
        internalLinkPopup.value.isVisible = false
    }

    function updateInternalLinkPopupPosition(position: { x: number; y: number }) {
        internalLinkPopup.value.position = position
    }

    return {
        notePreviewCard,
        openNotePreviewCard,
        closeNotePreviewCard,
        updateNotePreviewPosition,
        internalLinkPopup,
        openInternalLinkPopup,
        closeInternalLinkPopup,
        updateInternalLinkPopupPosition,
    }
}
