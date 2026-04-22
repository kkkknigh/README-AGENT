import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { nowIso } from "./time.js"

const PROFILE_KEY = "profile"
const API_KEYS_KEY = "api_keys"
const AUTH_KEY = "auth"
const INVITE_CODES_KEY = "invite_codes"

export const LOCAL_USER = {
  id: "desktop-user",
  username: "Desktop User",
  email: "desktop@local",
  role: "super_admin",
}

type StoredProfile = {
  username: string
  bio: string | null
  avatarUrl: string | null
  preferences: Record<string, unknown>
  createdAt: string
}

type StoredApiKey = {
  id: string
  name: string
  prefix: string
  isActive: boolean
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  apiKey: string
}

type StoredAuth = {
  password: string | null
}

export type InviteCodeRecord = {
  id: number
  code: string
  batch: number
  sequence: number
  ownerUsername: string | null
  ownerEmail: string | null
  useCount: number
  remainingUses: number
  createdAt: string | null
}

function loadSetting<T>(key: string, fallback: T): T {
  const row = db.prepare(`
    SELECT value_json
    FROM local_settings
    WHERE key = ?
  `).get(key) as { value_json: string } | undefined

  if (!row) return fallback
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return fallback
  }
}

function saveSetting(key: string, value: unknown) {
  const updatedAt = nowIso()
  db.prepare(`
    INSERT INTO local_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), updatedAt)
}

export function getProfile() {
  const fallback: StoredProfile = {
    username: LOCAL_USER.username,
    bio: "Local desktop mode",
    avatarUrl: null,
    preferences: {},
    createdAt: nowIso(),
  }
  return loadSetting(PROFILE_KEY, fallback)
}

export function updateProfile(patch: Partial<StoredProfile>) {
  const next: StoredProfile = {
    ...getProfile(),
    username: patch.username ?? getProfile().username,
    bio: patch.bio ?? getProfile().bio,
    avatarUrl: patch.avatarUrl ?? getProfile().avatarUrl,
    preferences: patch.preferences ?? getProfile().preferences,
    createdAt: getProfile().createdAt,
  }
  saveSetting(PROFILE_KEY, next)
  return next
}

export function getApiKeys() {
  return loadSetting<StoredApiKey[]>(API_KEYS_KEY, [])
}

export function createApiKey(name?: string, expiresInDays?: number | null) {
  const apiKeys = getApiKeys()
  const apiKey = `local_${Math.random().toString(36).slice(2)}`
  const createdAt = nowIso()
  const record: StoredApiKey = {
    id: nanoid(),
    name: name?.trim() || `Key ${apiKeys.length + 1}`,
    prefix: apiKey.slice(0, 8),
    isActive: true,
    createdAt,
    lastUsedAt: null,
    expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null,
    apiKey,
  }
  saveSetting(API_KEYS_KEY, [...apiKeys, record])
  return record
}

export function deleteApiKey(id: string) {
  saveSetting(API_KEYS_KEY, getApiKeys().filter((item) => item.id !== id))
}

export function getAuthState() {
  return loadSetting<StoredAuth>(AUTH_KEY, { password: null })
}

export function changePassword(oldPassword?: string, newPassword?: string) {
  const auth = getAuthState()
  if (auth.password && auth.password !== (oldPassword ?? "")) {
    throw new Error("Current password is incorrect")
  }
  saveSetting(AUTH_KEY, { password: newPassword?.trim() || null })
}

export function getStats() {
  const paperCount = (db.prepare(`SELECT COUNT(*) as count FROM remote_documents`).get() as { count: number }).count
  const noteCount = (db.prepare(`SELECT COUNT(*) as count FROM remote_notes`).get() as { count: number }).count
  const highlightCount = (db.prepare(`SELECT COUNT(*) as count FROM remote_highlights`).get() as { count: number }).count
  const chatCount = (db.prepare(`SELECT COUNT(*) as count FROM local_chat_threads`).get() as { count: number }).count
  const graphCount = getAllGraphNodeCount()
  return { paperCount, noteCount, highlightCount, chatCount, graphCount }
}

function getAllGraphNodeCount() {
  const rows = db.prepare(`
    SELECT payload_json
    FROM remote_graph_projects
    WHERE remote_deleted_at IS NULL
  `).all() as Array<{ payload_json: string }>

  return rows.reduce((count, row) => {
    const payload = JSON.parse(row.payload_json) as { nodes?: unknown[] }
    return count + (Array.isArray(payload.nodes) ? payload.nodes.length : 0)
  }, 0)
}

export function getInviteCodes() {
  return loadSetting<InviteCodeRecord[]>(INVITE_CODES_KEY, [])
}

export function saveInviteCodes(items: InviteCodeRecord[]) {
  saveSetting(INVITE_CODES_KEY, items)
}

export function resetLocalAccount() {
  saveSetting(API_KEYS_KEY, [])
  saveSetting(AUTH_KEY, { password: null })
}
