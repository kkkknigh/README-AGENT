import { defineStore } from 'pinia'

export const useRoadmapStore = defineStore('roadmap', () => {
    // 之前由 Pinia 管理的数据现已全部收归 Vue Query (useRoadmapQuery)
    // 此 Store 仅保留极少量跨组件使用的 UI 交互状态（如有）

    function resetForNewDocument() {
        // 数据现由 Vue Query 自动基于 pdfId 刷新
    }

    function clearAllData() {
        // 数据现由 Vue Query 缓存管理
    }

    return {
        resetForNewDocument,
        clearAllData
    }
})
