import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { LOCAL_USER, getInviteCodes, saveInviteCodes } from "./profile.js"
import { nowIso } from "./time.js"

export function getDashboard() {
  const totalUsers = 1
  const activeToday = 1
  const totalDocuments = (db.prepare(`SELECT COUNT(*) as count FROM remote_documents`).get() as { count: number }).count
  const totalChats = (db.prepare(`SELECT COUNT(*) as count FROM local_chat_threads`).get() as { count: number }).count
  return {
    stats: { totalUsers, activeToday, totalDocuments, totalChats },
    growth: [] as Array<{ date: string; newUsers: number; activeUsers: number; newDocuments: number }>,
  }
}

export function listUsers(input?: {
  page?: number
  perPage?: number
  search?: string
  role?: string
  isActive?: string | boolean
}) {
  const item = {
    id: LOCAL_USER.id,
    username: LOCAL_USER.username,
    email: LOCAL_USER.email,
    role: LOCAL_USER.role,
    isActive: true,
    createdAt: nowIso(),
    lastActiveAt: nowIso(),
  }

  let items = [item]
  if (input?.search?.trim()) {
    const keyword = input.search.trim().toLowerCase()
    items = items.filter((user) => user.username.toLowerCase().includes(keyword) || user.email.toLowerCase().includes(keyword))
  }
  if (input?.role) {
    items = items.filter((user) => user.role === input.role)
  }
  if (input?.isActive !== undefined && input?.isActive !== "") {
    const expected = String(input.isActive) === "true"
    items = items.filter((user) => user.isActive === expected)
  }

  return {
    items,
    total: items.length,
    page: input?.page ?? 1,
    perPage: input?.perPage ?? 20,
  }
}

export function updateUser(_userId: string, _patch: { role?: string; isActive?: boolean }) {
  return { success: true }
}

export function deleteUser(_userId: string) {
  return { success: true }
}

export function listInviteCodes(input?: {
  page?: number
  perPage?: number
  search?: string
  batch?: number
}) {
  let items = getInviteCodes()
  if (input?.search?.trim()) {
    const keyword = input.search.trim().toLowerCase()
    items = items.filter((item) =>
      item.code.toLowerCase().includes(keyword)
      || item.ownerUsername?.toLowerCase().includes(keyword)
      || item.ownerEmail?.toLowerCase().includes(keyword),
    )
  }
  if (input?.batch != null) {
    items = items.filter((item) => item.batch === input.batch)
  }

  const page = input?.page ?? 1
  const perPage = input?.perPage ?? 20
  const start = (page - 1) * perPage
  return {
    items: items.slice(start, start + perPage),
    total: items.length,
    page,
    perPage,
  }
}

export function createInviteCodes(input: {
  owner?: string
  remainingUses?: number
  batch?: number
  count?: number
}) {
  const items = getInviteCodes()
  const nextCount = Math.max(1, Math.min(50, input.count ?? 1))
  const batch = input.batch ?? 0
  const remainingUses = input.remainingUses ?? 20
  let lastId = items.reduce((max, item) => Math.max(max, item.id), 0)

  const created = Array.from({ length: nextCount }, (_, index) => {
    lastId += 1
    return {
      id: lastId,
      code: `${batch.toString().padStart(2, "0")}-${nanoid(8).toUpperCase()}`,
      batch,
      sequence: index + 1,
      ownerUsername: input.owner ?? null,
      ownerEmail: input.owner?.includes("@") ? input.owner : null,
      useCount: 0,
      remainingUses,
      createdAt: nowIso(),
    }
  })

  saveInviteCodes([...created, ...items])
  return { success: true, items: created }
}

export function updateInviteCode(id: number, patch: { remainingUses: number }) {
  const items = getInviteCodes().map((item) => (
    item.id === id ? { ...item, remainingUses: patch.remainingUses } : item
  ))
  saveInviteCodes(items)
  return { success: true }
}

export function deleteInviteCode(id: number) {
  saveInviteCodes(getInviteCodes().filter((item) => item.id !== id))
  return { success: true }
}

export function batchDeleteInviteCodes(ids: number[]) {
  const idSet = new Set(ids)
  saveInviteCodes(getInviteCodes().filter((item) => !idSet.has(item.id)))
  return { success: true }
}
