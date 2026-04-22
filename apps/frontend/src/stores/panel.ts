import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { AiPanelTab } from '../types'

// ---- localStorage 读写辅助 ----
function loadBool(key: string, fallback: boolean): boolean {
    const raw = localStorage.getItem(key)
    return raw !== null ? raw === 'true' : fallback
}

function loadNumber(key: string, fallback: number): number {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
}

export const usePanelStore = defineStore('panel', () => {
    // ==================== AI 面板标签 ====================
    const tabs: AiPanelTab[] = [
        { id: 'roadmap', label: 'Roadmap', icon: 'map' },
        { id: 'translation', label: 'Translation', icon: 'translate' },
    ]
    const activeTab = ref<AiPanelTab['id']>((localStorage.getItem('readme_active_tab') as AiPanelTab['id']) || 'roadmap')
    const isPanelHidden = ref(loadBool('readme_panel_hidden', false))

    watch(activeTab, (val) => localStorage.setItem('readme_active_tab', val))
    watch(isPanelHidden, (val) => localStorage.setItem('readme_panel_hidden', String(val)))

    // ==================== 右侧边栏布局状态 ====================
    const notesVisible = ref(loadBool('readme_layout_notes_visible', false))
    const chatVisible = ref(loadBool('readme_layout_chat_visible', false))
    const notesMinimized = ref(loadBool('readme_layout_notes_minimized', false))
    const chatMinimized = ref(loadBool('readme_layout_chat_minimized', false))
    const sidebarWidth = ref(loadNumber('readme_layout_sidebar_width', 480))
    const splitRatio = ref(loadNumber('readme_layout_split_ratio', 0.45))

    watch(notesVisible, (val) => localStorage.setItem('readme_layout_notes_visible', String(val)))
    watch(chatVisible, (val) => localStorage.setItem('readme_layout_chat_visible', String(val)))
    watch(notesMinimized, (val) => localStorage.setItem('readme_layout_notes_minimized', String(val)))
    watch(chatMinimized, (val) => localStorage.setItem('readme_layout_chat_minimized', String(val)))
    // sidebarWidth / splitRatio 拖拽时变化频繁，防抖 1 秒后再写入
    let _widthTimer: ReturnType<typeof setTimeout> | null = null
    let _ratioTimer: ReturnType<typeof setTimeout> | null = null

    watch(sidebarWidth, (val) => {
        if (_widthTimer) clearTimeout(_widthTimer)
        _widthTimer = setTimeout(() => localStorage.setItem('readme_layout_sidebar_width', String(val)), 1000)
    })
    watch(splitRatio, (val) => {
        if (_ratioTimer) clearTimeout(_ratioTimer)
        _ratioTimer = setTimeout(() => localStorage.setItem('readme_layout_split_ratio', String(val)), 1000)
    })

    // 侧边栏可见性：至少有一个面板展开时才显示
    const sidebarVisible = computed(() => {
        return (notesVisible.value && !notesMinimized.value)
            || (chatVisible.value && !chatMinimized.value)
    })

    // 消息选择模式
    const selectionMode = ref(false)
    const selectedMessageIds = ref<Set<string>>(new Set())

    // 切换当前激活的 tab
    function setActiveTab(tabId: AiPanelTab['id']) {
        activeTab.value = tabId
    }

    // 折叠/展开侧边面板
    function togglePanel() {
        isPanelHidden.value = !isPanelHidden.value
    }

    // -----------------------------
    // 消息选择相关
    // -----------------------------
    function toggleSelectionMode() {
        selectionMode.value = !selectionMode.value
        if (!selectionMode.value) {
            selectedMessageIds.value = new Set()
        }
    }

    function toggleMessageSelection(id: string) {
        const newSet = new Set(selectedMessageIds.value)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            newSet.add(id)
        }
        selectedMessageIds.value = newSet
    }

    return {
        tabs,
        activeTab,
        isPanelHidden,
        // 布局状态
        notesVisible,
        chatVisible,
        notesMinimized,
        chatMinimized,
        sidebarWidth,
        splitRatio,
        sidebarVisible,
        // 消息选择
        selectionMode,
        selectedMessageIds,
        setActiveTab,
        togglePanel,
        toggleSelectionMode,
        toggleMessageSelection,
    }
})
