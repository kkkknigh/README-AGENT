import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ChatMode } from '../api'

const FAVORITES_KEY = 'readme_chat_favorites'

function loadFavorites(): Set<string> {
    try {
        const raw = localStorage.getItem(FAVORITES_KEY)
        return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch { return new Set() }
}

export const useChatStore = defineStore('chat', () => {
    // 仅保留当前激活的会话 ID 为本地 UI 状态
    const currentSessionId = ref<string | null>(sessionStorage.getItem('readme_current_session') || null)
    const chatMode = ref<ChatMode>((sessionStorage.getItem('readme_chat_mode') as ChatMode) || 'agent')

    // 收藏会话 ID 集合
    const favoriteIds = ref<Set<string>>(loadFavorites())

    if (chatMode.value !== 'agent' && chatMode.value !== 'chat') {
        chatMode.value = 'agent'
    }

    watch(currentSessionId, (newId) => {
        if (newId) {
            sessionStorage.setItem('readme_current_session', newId)
        } else {
            sessionStorage.removeItem('readme_current_session')
        }
    })

    watch(chatMode, (mode) => {
        sessionStorage.setItem('readme_chat_mode', mode)
    })

    function setChatMode(mode: ChatMode) {
        chatMode.value = mode
    }

    function toggleChatMode() {
        chatMode.value = chatMode.value === 'agent' ? 'chat' : 'agent'
    }

    function clearChat() {
        currentSessionId.value = null
    }

    function resetForNewDocument() {
        currentSessionId.value = null
    }

    // ---- 收藏管理 ----
    function _saveFavorites() {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteIds.value]))
    }

    function toggleFavorite(id: string) {
        const next = new Set(favoriteIds.value)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        favoriteIds.value = next
        _saveFavorites()
    }

    function batchAddFavorites(ids: Iterable<string>) {
        const next = new Set(favoriteIds.value)
        for (const id of ids) next.add(id)
        favoriteIds.value = next
        _saveFavorites()
    }

    function isFavorite(id: string): boolean {
        return favoriteIds.value.has(id)
    }

    function clearAllData() {
        currentSessionId.value = null
        sessionStorage.removeItem('readme_current_session')
        chatMode.value = 'agent'
        sessionStorage.removeItem('readme_chat_mode')
        favoriteIds.value = new Set()
        localStorage.removeItem(FAVORITES_KEY)
    }

    return {
        currentSessionId,
        chatMode,
        favoriteIds,
        setChatMode,
        toggleChatMode,
        clearChat,
        resetForNewDocument,
        toggleFavorite,
        batchAddFavorites,
        isFavorite,
        clearAllData,
    }
})
