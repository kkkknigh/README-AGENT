/**
 * 用户行为埋点工具模块
 *
 * 职责：
 * 1. 提供 trackEvent(eventName, fields) 统一上报接口
 * 2. 自动注入公共字段（visit_id, platform, device_type）
 * 3. 批量缓冲 + 定时上报 + 页面关闭 sendBeacon 兜底
 */

import { getAccessToken } from '../api'

// ==================== 常量 ====================

const FLUSH_INTERVAL_MS = 5_000       // 5 秒定时刷新
const MAX_BUFFER_SIZE = 20            // 缓冲超过 20 条立即刷新
const API_URL = `${__READMECLAW_LOCAL_RUNTIME_URL__ ?? "http://127.0.0.1:4242"}/events`

// ==================== visit_id 管理 ====================

const VISIT_ID_KEY = 'readme_visit_id'

function getOrCreateVisitId(): string {
  let id = sessionStorage.getItem(VISIT_ID_KEY)
  if (!id) {
    id = crypto.randomUUID?.() ?? (`${Date.now()}-${Math.random().toString(36).slice(2)}`)
    sessionStorage.setItem(VISIT_ID_KEY, id)
  }
  return id
}

// ==================== 公共字段 ====================

function getDeviceType(): 'desktop' | 'mobile' | 'tablet' {
  const ua = navigator.userAgent
  if (/Mobi|Android/i.test(ua)) return 'mobile'
  if (/Tablet|iPad/i.test(ua)) return 'tablet'
  return 'desktop'
}

function getCommonFields() {
  return {
    source: 'frontend',
    visit_id: getOrCreateVisitId(),
    platform: 'web',
    device_type: getDeviceType(),
  }
}

// ==================== 缓冲与上报 ====================

let buffer: Record<string, unknown>[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null

function startFlushTimer() {
  if (flushTimer) return
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS)
}

function stopFlushTimer() {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
}

/**
 * 将缓冲区内容上报到后端
 */
function flush() {
  // 单次flush操作，将缓冲区内容上报到后端
  if (buffer.length === 0) return

  const token = getAccessToken()
  if (!token) return  // 未登录或 token 刷新中，保留 buffer 等下次 flush

  const events = buffer.splice(0) // 获取缓冲区内容
  const body = JSON.stringify({ events }) // 将缓冲区内容转换为 JSON 字符串

  // 优先使用 fetch（支持 keepalive，页面关闭时也能发送）
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }

  try {
    fetch(API_URL, {
      method: 'POST',
      headers,
      body,
      credentials: 'include',
      keepalive: true,
    }).catch(() => {
      // 静默失败，不阻塞用户操作
    })
  } catch {
    // 静默
  }
}

/**
 * 页面关闭时兜底：使用 fetch + keepalive（等效 sendBeacon，但支持自定义 header 携带 JWT）
 */
function flushBeacon() {
  if (buffer.length === 0) return

  const token = getAccessToken()
  if (!token) return  // 同 flush()，保留 buffer

  const events = buffer.splice(0)
  const body = JSON.stringify({ events })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }

  try {
    fetch(API_URL, {
      method: 'POST',
      headers,
      body,
      credentials: 'include',
      keepalive: true,
    }).catch(() => {})
  } catch {
    // 静默
  }
}

// ==================== 公开 API ====================

/**
 * 上报一个埋点事件
 * 
 * @param eventName 事件名（如 'page_opened'）
 * @param fields 事件专属字段
 */
export function trackEvent(eventName: string, fields: Record<string, unknown> = {}) {
  const event = {
    event_name: eventName,
    ...getCommonFields(),
    ...fields,
  }
  buffer.push(event)

  if (buffer.length >= MAX_BUFFER_SIZE) {
    flush()
  }
}

/**
 * 立即刷新缓冲区（用于需要确保发送的场景）
 */
export function flushEvents() {
  flush()
}

// ==================== 生命周期 ====================

/**
 * 初始化追踪模块（应用启动时调用一次）
 */
export function initTracking() {
  startFlushTimer()

  // 页面关闭 / 隐藏时尽力发送
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushBeacon()
    }
  })
  window.addEventListener('pagehide', flushBeacon)
}

/**
 * 重置 visit_id（登出时调用，确保下次登录产生新的会话标识）
 */
export function resetVisitId() {
  sessionStorage.removeItem(VISIT_ID_KEY)
}

/**
 * 停止追踪（通常不需要调用）
 */
export function stopTracking() {
  flush()
  stopFlushTimer()
}
