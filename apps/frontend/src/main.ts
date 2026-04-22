import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { queryClient } from './queryClient'
import './styles/index.css'
import App from './App.vue'
import router from './router'
import i18n from './locales'
import { STORES, dbCleanExpired, dbClearAll } from './utils/db'
import { syncChannel, type SyncMessage } from './utils/broadcast'
import { chatKeys } from './composables/queries/useChatQueries'
import { useTranslationStore } from './stores/translation'

// ==================== 早期过期会话检测 ====================
// 在 Pinia Store 初始化和 Vue Query 恢复之前，同步检测并清理过期的临时会话数据。
// 防止新标签页继承 localStorage/IndexedDB 中的陈旧业务数据（但 sessionStorage 已丢失用户信息）。
const _sessionMode = localStorage.getItem('readme_session_mode')
const _hasUser = !!localStorage.getItem('readme_user') || !!sessionStorage.getItem('readme_user')

if (_sessionMode === 'temporary' && !_hasUser) {
  console.warn('[Main] Detected stale temporary session. Cleaning persisted business data before store initialization.')
  // 同步清理 localStorage 中的业务键，防止 Store 初始化时读取到陈旧数据
  const staleKeys = [
    'readme_user', 'readme_session_mode', 'readme_current_session',
        'last_user_id', 'readme_library_current', 'readme_last_heartbeat', 'readme_user_data_cache',
  ]
  staleKeys.forEach(key => localStorage.removeItem(key))
    staleKeys.forEach(key => sessionStorage.removeItem(key))
  // 扫描清理所有 readme_ 前缀的键
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('readme_')) localStorage.removeItem(key)
  })
  // 异步清理 IndexedDB（不阻塞启动，但尽早执行）
  dbClearAll().catch(e => console.warn('[Main] Failed to clear IndexedDB during stale session cleanup:', e))
}

// 启动时清理过期缓存
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
dbCleanExpired(STORES.PDFS, SEVEN_DAYS_MS).catch(e => console.warn('Cache cleanup failed:', e))
dbCleanExpired(STORES.PDF_PARAGRAPHS, SEVEN_DAYS_MS).catch(console.warn)
dbCleanExpired(STORES.TRANSLATIONS, SEVEN_DAYS_MS).catch(console.warn)
dbCleanExpired(STORES.HIGHLIGHTS, THIRTY_DAYS_MS).catch(console.warn)
dbCleanExpired(STORES.BRIEFS, THIRTY_DAYS_MS).catch(console.warn)
dbCleanExpired(STORES.ROADMAPS, THIRTY_DAYS_MS).catch(console.warn)
dbCleanExpired(STORES.KG_DETAILS, THIRTY_DAYS_MS).catch(console.warn)
dbCleanExpired(STORES.KG_TREES, THIRTY_DAYS_MS).catch(console.warn)
dbCleanExpired(STORES.CHAT_SESSIONS, THIRTY_DAYS_MS).catch(console.warn)

const app = createApp(App)
const pinia = createPinia()
const translationStore = useTranslationStore(pinia)

// 跨标签页同步逻辑：接收广播后使对应 Query 失效
syncChannel.addEventListener('message', (event: MessageEvent<SyncMessage>) => {
    const { type, payload } = event.data
    switch (type) {
        case 'RELOAD_LIBRARY':
            queryClient.invalidateQueries({ queryKey: ['documents'] })
            break
        case 'RELOAD_SESSIONS':
            // 如果提供了 pdfId，则只失效该 PDF 的会话列表；否则失效所有会话列表
            if (payload?.pdfId) {
                queryClient.invalidateQueries({ queryKey: chatKeys.sessions(payload.pdfId) })
            } else {
                queryClient.invalidateQueries({ queryKey: [...chatKeys.all, 'sessions'] })
            }
            break
        case 'RELOAD_MESSAGES':
            if (payload?.sessionId) {
                queryClient.invalidateQueries({ queryKey: chatKeys.messages(payload.sessionId) })
            }
            break
        case 'RELOAD_HIGHLIGHTS':
            queryClient.invalidateQueries({ queryKey: ['highlights', payload].filter(Boolean) })
            break
        case 'RELOAD_NOTES':
            queryClient.invalidateQueries({ queryKey: ['notes', payload].filter(Boolean) })
            break
        case 'RELOAD_PROFILE':
            queryClient.invalidateQueries({ queryKey: ['profile'] })
            break
        case 'SYNC_TRANSLATION':
            if (typeof payload?.paragraphId === 'string' && typeof payload?.translation === 'string' && payload.translation.trim()) {
                translationStore.setTranslatedParagraph(payload.paragraphId, payload.translation, payload.pdfId)
            }
            break
    }
})

app.use(pinia)
app.use(router)
app.use(i18n)
app.use(VueQueryPlugin, { queryClient })

// 初始化埋点追踪
import { initTracking } from './utils/tracking'
initTracking()

app.mount('#app')


