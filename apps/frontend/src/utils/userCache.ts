import type { UserProfile, UserStats } from '../stores/profile'

export type SessionPersistenceMode = 'persistent' | 'temporary'

export interface UserDataCacheSnapshot {
  me?: UserProfile
  stats?: UserStats
  cachedAt: number
}

const USER_DATA_CACHE_KEY = 'readme_user_data_cache'
const ME_CACHE_TTL_MS = 1000 * 60 * 30
const STATS_CACHE_TTL_MS = 1000 * 60 * 5

function parseSnapshot(raw: string | null): UserDataCacheSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as UserDataCacheSnapshot
    if (!parsed || typeof parsed !== 'object' || typeof parsed.cachedAt !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

export function saveUserDataCache(snapshot: Omit<UserDataCacheSnapshot, 'cachedAt'>, mode: SessionPersistenceMode) {
  const value = JSON.stringify({ ...snapshot, cachedAt: Date.now() })
  if (mode === 'persistent') {
    localStorage.setItem(USER_DATA_CACHE_KEY, value)
    sessionStorage.removeItem(USER_DATA_CACHE_KEY)
  } else {
    sessionStorage.setItem(USER_DATA_CACHE_KEY, value)
    localStorage.removeItem(USER_DATA_CACHE_KEY)
  }
}

export function clearUserDataCache() {
  localStorage.removeItem(USER_DATA_CACHE_KEY)
  sessionStorage.removeItem(USER_DATA_CACHE_KEY)
}

export function getUserDataCacheSnapshot(): UserDataCacheSnapshot | null {
  const raw = localStorage.getItem(USER_DATA_CACHE_KEY) || sessionStorage.getItem(USER_DATA_CACHE_KEY)
  return parseSnapshot(raw)
}

export function getCachedMe(): UserProfile | undefined {
  const snapshot = getUserDataCacheSnapshot()
  if (!snapshot?.me) return undefined
  if ((Date.now() - snapshot.cachedAt) > ME_CACHE_TTL_MS) return undefined
  return snapshot.me
}

export function getCachedStats(): UserStats | undefined {
  const snapshot = getUserDataCacheSnapshot()
  if (!snapshot?.stats) return undefined
  if ((Date.now() - snapshot.cachedAt) > STATS_CACHE_TTL_MS) return undefined
  return snapshot.stats
}
