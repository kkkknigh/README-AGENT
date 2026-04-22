/**
 * ============================================================================
 * 统一 IndexedDB 管理器
 *
 * 功能：为整个前端应用提供统一的 IndexedDB 读写接口。
 * 所有需要 IndexedDB 持久化的模块（PDF 缓存、文献库、翻译缓存、聊天会话等）
 * 均通过此管理器进行操作，避免各模块各自维护数据库连接。
 *
 * 设计要点：
 * - 单例模式：全局共用一个 IDBDatabase 实例
 * - 统一版本管理：所有 object store 在同一个数据库中
 * - 所有记录自动附加 cachedAt 时间戳，用于定时过期清除
 * ============================================================================
 */

const DB_NAME = 'readme_app_db'
const DB_VERSION = 9

/**
 * 所有 Object Store 的名称常量
 */
export const STORES = {
    PDFS: 'pdfs',                   // PDF Blob 缓存
    LIBRARY: 'library',             // 文献元数据
    CHAT_SESSIONS: 'chat_sessions', // 聊天会话元数据
    CHAT_MESSAGES: 'chat_messages', // 聊天消息 (key = message.id)
    NOTES: 'notes',                 // 笔记数据
    PROPOSALS: 'proposals',         // Proposal 审批记录 (key = proposal.id)
    HIGHLIGHTS: 'highlights',       // 高亮标注 (key = pdfId, value = { id, highlights[] })
    BRIEFS: 'briefs',               // 论文结构化摘要 (key = pdfId, value = { id, data })
    ROADMAPS: 'roadmaps',           // 引用图缓存 (key = pdfId, value = { id, data })
    KG_DETAILS: 'kg_details',       // 知识图谱项目详情 (key = projectId)
    KG_TREES: 'kg_trees',           // 知识图谱树形结构 (key = projectId)
    PDF_PARAGRAPHS: 'pdf_paragraphs', // PDF 段落数据 (key = pdfId, value = { id, paragraphs[] })
    TRANSLATIONS: 'translations',   // 翻译缓存 (key = paragraphId, value = { id, pdfId, translation })
    HTML_CONTENT: 'html_content',   // HTML 重排缓存 (key = pdfId, value = { id, htmlContent, mapping, htmlSource })
} as const

type StoreName = (typeof STORES)[keyof typeof STORES]

// 单例数据库实例
let dbInstance: IDBDatabase | null = null

/**
 * 打开（或获取已打开的）IndexedDB 数据库实例
 */
function openDB(): Promise<IDBDatabase> {
    // 校验缓存实例版本是否匹配，不匹配时关闭旧连接重新打开
    if (dbInstance) {
        if (dbInstance.version === DB_VERSION) return Promise.resolve(dbInstance)
        try { dbInstance.close() } catch { /* ignore */ }
        dbInstance = null
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        // 超时保护：防止 onblocked 导致 promise 永久挂起
        const timeout = setTimeout(() => {
            console.error('[DB] openDB timed out (blocked or unresponsive)')
            reject(new Error('IndexedDB open timed out'))
        }, 3000)

        request.onerror = () => {
            clearTimeout(timeout)
            console.error('[DB] Failed to open IndexedDB:', request.error)
            reject(request.error)
        }

        request.onblocked = () => {
            console.warn('[DB] Database upgrade blocked — close other tabs to proceed')
            // 不 reject，留给超时兜底；如果后续 onsuccess 触发则正常恢复
        }

        request.onsuccess = () => {
            clearTimeout(timeout)
            dbInstance = request.result

            // 当数据库连接意外关闭时，清除单例引用
            dbInstance.onclose = () => {
                dbInstance = null
            }

            // 其他标签页请求升级时，主动关闭连接让升级通过
            dbInstance.onversionchange = () => {
                dbInstance?.close()
                dbInstance = null
            }

            resolve(dbInstance)
        }

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result

            // 删除已废弃的 query_cache store（v5 → v6 迁移）
            if (db.objectStoreNames.contains('query_cache')) {
                db.deleteObjectStore('query_cache')
            }

            // 创建所有需要的 object store
            for (const storeName of Object.values(STORES)) {
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath: 'id' })
                }
            }
        }
    })
}

// ======================== 通用 CRUD 操作 ========================

/**
 * 深拷贝数据，去掉 Vue 响应式代理（Proxy），使其可被 structuredClone/IDB 序列化。
 */
function toPlain<T>(data: T): T {
    try {
        return JSON.parse(JSON.stringify(data))
    } catch {
        return data
    }
}

/**
 * 存入数据（插入或更新）
 * 自动添加 cachedAt 时间戳
 */
export async function dbPut<T extends { id: string | number }>(storeName: StoreName, data: T): Promise<void> {
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite')
            const store = tx.objectStore(storeName)
            const record = { ...toPlain(data), cachedAt: Date.now() }
            const request = store.put(record)
            request.onsuccess = () => resolve()
            request.onerror = () => {
                console.error(`[DB] put failed for ${storeName}:`, request.error)
                reject(request.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
    }
}

/**
 * 存入数据（跳过 toPlain 序列化）
 * 用于保存 Blob 等不可 JSON 序列化的对象
 */
export async function dbPutRaw<T extends { id: string | number }>(storeName: StoreName, data: T): Promise<void> {
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite')
            const store = tx.objectStore(storeName)
            const record = { ...data, cachedAt: Date.now() }
            const request = store.put(record)
            request.onsuccess = () => resolve()
            request.onerror = () => {
                console.error(`[DB] putRaw failed for ${storeName}:`, request.error)
                reject(request.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
    }
}

/**
 * 更新现有数据（读取-合并-写入）
 * 适用于只持有部分字段的情况，防止覆盖导致其他字段丢失
 */
export async function dbUpdate<T extends { id: string | number }>(
    storeName: StoreName,
    id: string | number,
    changes: Partial<T>
): Promise<void> {
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite')
            const store = tx.objectStore(storeName)
            const getRequest = store.get(id)

            getRequest.onsuccess = () => {
                const existing = getRequest.result
                if (existing) {
                    const updated = {
                        ...existing,
                        ...toPlain(changes),
                        cachedAt: Date.now()
                    }
                    store.put(updated)
                }
            }

            tx.oncomplete = () => resolve()
            tx.onerror = () => {
                console.error(`[DB] update failed for ${storeName}/${id}:`, tx.error)
                reject(tx.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
    }
}

/**
 * 批量存入数据
 */
export async function dbPutMany<T extends { id: string | number }>(storeName: StoreName, items: T[]): Promise<void> {
    if (items.length === 0) return
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite')
            const store = tx.objectStore(storeName)
            const now = Date.now()
            for (const item of items) {
                store.put({ ...toPlain(item), cachedAt: now })
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => {
                console.error(`[DB] putMany failed for ${storeName}:`, tx.error)
                reject(tx.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
    }
}

/**
 * 读取单条数据
 */
export async function dbGet<T = any>(storeName: StoreName, key: string | number): Promise<T | null> {
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly')
            const store = tx.objectStore(storeName)
            const request = store.get(key)
            request.onsuccess = () => {
                resolve(request.result ?? null)
            }
            request.onerror = () => {
                console.error(`[DB] get failed for ${storeName}/${key}:`, request.error)
                reject(request.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
        return null
    }
}

/**
 * 读取 store 中的所有数据
 */
export async function dbGetAll<T = any>(storeName: StoreName): Promise<T[]> {
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly')
            const store = tx.objectStore(storeName)
            const request = store.getAll()
            request.onsuccess = () => {
                resolve(request.result ?? [])
            }
            request.onerror = () => {
                console.error(`[DB] getAll failed for ${storeName}:`, request.error)
                reject(request.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
        return []
    }
}

/**
 * 批量读取指定 key 的数据（比 dbGetAll 更高效，只查询需要的记录）
 */
export async function dbGetMany<T = any>(storeName: StoreName, keys: (string | number)[]): Promise<T[]> {
    if (keys.length === 0) return []
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly')
            const store = tx.objectStore(storeName)
            const results: T[] = []
            for (const key of keys) {
                const request = store.get(key)
                request.onsuccess = () => {
                    if (request.result != null) results.push(request.result)
                }
            }
            tx.oncomplete = () => resolve(results)
            tx.onerror = () => {
                console.error(`[DB] getMany failed for ${storeName}:`, tx.error)
                reject(tx.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
        return []
    }
}

/**
 * 删除单条数据
 */
export async function dbDelete(storeName: StoreName, key: string | number): Promise<void> {
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite')
            const store = tx.objectStore(storeName)
            const request = store.delete(key)
            request.onsuccess = () => resolve()
            request.onerror = () => {
                console.error(`[DB] delete failed for ${storeName}/${key}:`, request.error)
                reject(request.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
    }
}

/**
 * 清空整个 object store
 */
export async function dbClear(storeName: StoreName): Promise<void> {
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite')
            const store = tx.objectStore(storeName)
            const request = store.clear()
            request.onsuccess = () => resolve()
            request.onerror = () => {
                console.error(`[DB] clear failed for ${storeName}:`, request.error)
                reject(request.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
    }
}

/**
 * 清空数据库中的所有 object stores
 * 用于在登出或会话清理时彻底抹除本地数据
 */
export async function dbClearAll(): Promise<void> {
    try {
        const db = await openDB()
        const storeNames = Object.values(STORES)

        // 串行处理，检查 store 是否存在
        for (const storeName of storeNames) {
            if (!db.objectStoreNames.contains(storeName)) {
                console.warn(`[DB] Skip clearing non-existent store: ${storeName}`)
                continue
            }
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite')
                const store = tx.objectStore(storeName)
                const request = store.clear()
                request.onsuccess = () => resolve()
                request.onerror = () => {
                    console.error(`[DB] clearAll failed for ${storeName}:`, request.error)
                    reject(request.error)
                }
            })
        }
        console.log('[DB] All applicable object stores cleared successfully.')
    } catch (error) {
        console.warn('[DB] Failed to clear all stores', error)
    }
}

/**
 * 批量存入数据，保留已有记录中的指定字段（read-merge-write）
 * 适用于 API refetch 写回时不覆盖本地独有的 steps/thoughts 等字段
 */
export async function dbPutManyPreserving<T extends { id: string | number }>(
    storeName: StoreName,
    items: T[],
    preserveFields: string[]
): Promise<void> {
    if (items.length === 0) return
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite')
            const store = tx.objectStore(storeName)
            const now = Date.now()

            for (const item of items) {
                const getReq = store.get(item.id)
                getReq.onsuccess = () => {
                    const existing = getReq.result
                    const record: any = { ...toPlain(item), cachedAt: now }
                    if (existing) {
                        for (const field of preserveFields) {
                            const oldVal = existing[field]
                            const newVal = record[field]
                            // 保留旧值：新值为 undefined/null 或空数组时不覆盖有值的缓存
                            const newIsEmpty = newVal === undefined || newVal === null
                                || (Array.isArray(newVal) && newVal.length === 0)
                            const oldHasValue = oldVal !== undefined && oldVal !== null
                                && !(Array.isArray(oldVal) && oldVal.length === 0)
                            if (newIsEmpty && oldHasValue) {
                                record[field] = oldVal
                            }
                        }
                    }
                    store.put(record)
                }
            }

            tx.oncomplete = () => resolve()
            tx.onerror = () => {
                console.error(`[DB] putManyPreserving failed for ${storeName}:`, tx.error)
                reject(tx.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
    }
}

/**
 * 批量删除数据
 */
export async function dbDeleteMany(storeName: StoreName, keys: (string | number)[]): Promise<void> {
    if (keys.length === 0) return
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite')
            const store = tx.objectStore(storeName)
            for (const key of keys) {
                store.delete(key)
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => {
                console.error(`[DB] deleteMany failed for ${storeName}:`, tx.error)
                reject(tx.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
    }
}

// ======================== 过期清除 ========================

/**
 * 清除指定 store 中超过 maxAgeMs 毫秒的过期记录
 * @param storeName  目标 store 名
 * @param maxAgeMs   最大存活时间（毫秒）
 * @returns 被清除的记录数
 */
export async function dbCleanExpired(storeName: StoreName, maxAgeMs: number): Promise<number> {
    try {
        const db = await openDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite')
            const store = tx.objectStore(storeName)
            const request = store.getAll()
            let deletedCount = 0

            request.onsuccess = () => {
                const now = Date.now()
                const records = request.result || []
                for (const record of records) {
                    if (record.cachedAt && (now - record.cachedAt) > maxAgeMs) {
                        store.delete(record.id)
                        deletedCount++
                    }
                }
            }

            tx.oncomplete = () => {
                if (deletedCount > 0) {
                    console.log(`[DB] Cleaned ${deletedCount} expired records from ${storeName}`)
                }
                resolve(deletedCount)
            }

            tx.onerror = () => {
                console.error(`[DB] cleanExpired failed for ${storeName}:`, tx.error)
                reject(tx.error)
            }
        })
    } catch (error) {
        console.warn(`[DB] IndexedDB not available for ${storeName}`, error)
        return 0
    }
}
