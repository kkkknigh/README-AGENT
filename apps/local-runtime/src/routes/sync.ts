import { Router } from "express"
import { buildReservedRemoteMessage, getRemoteSettings } from "../services/remote.js"
import { listRemoteDocuments } from "../services/mirror.js"
import { db } from "../db/index.js"

export const syncRouter = Router()

syncRouter.get("/status", (_req, res) => {
  const checkpoint = db.prepare(`
    SELECT resource_name, cursor_value, last_synced_at, last_error
    FROM sync_checkpoints
    WHERE resource_name = 'bootstrap'
  `).get() as {
    resource_name: string
    cursor_value: string | null
    last_synced_at: string | null
    last_error: string | null
  } | undefined

  const documentCount = db.prepare(`SELECT COUNT(*) as count FROM remote_documents`).get() as { count: number }

  res.json({
    state: checkpoint?.last_error ? "error" : "clean",
    cursor: checkpoint?.cursor_value ?? null,
    lastSyncedAt: checkpoint?.last_synced_at ?? null,
    lastError: checkpoint?.last_error ?? null,
    documentCount: documentCount.count,
  })
})

syncRouter.post("/bootstrap", async (_req, res, next) => {
  try {
    const settings = getRemoteSettings()
    res.status(202).json({
      state: "idle",
      serverTime: new Date().toISOString(),
      remoteBaseUrl: settings.baseUrl,
      documentCount: 0,
      noteCount: 0,
      graphProjectCount: 0,
      implemented: false,
      message: buildReservedRemoteMessage(settings),
    })
  } catch (error) {
    next(error)
  }
})

syncRouter.post("/documents", (_req, res) => {
  res.json({ items: listRemoteDocuments() })
})

syncRouter.post("/notes", (_req, res) => {
  res.json({ items: [] })
})

syncRouter.post("/graph", (_req, res) => {
  res.json({ items: [] })
})
