import type {
  RemoteApiClient,
  RemoteApiConfig,
  RemoteBootstrapPayload,
} from "@readmeclaw/remote-contracts"
import { db } from "../db/index.js"
import { appConfig } from "../config.js"
import { nowIso } from "./time.js"

function buildFallbackBootstrap(): RemoteBootstrapPayload {
  const serverTime = new Date().toISOString()
  return {
    serverTime,
    documents: [
      {
        id: "demo-paper-1",
        title: "READMEClaw Remote Mirror Demo",
        pageCount: 12,
        authors: ["READMEClaw"],
        tags: ["demo", "agent"],
        uploadedAt: serverTime,
        processStatus: "mineru_completed",
        htmlStatus: "completed",
        metadata: { source: "local-fallback" },
      },
    ],
    notes: [
      {
        id: 1,
        title: "迁移说明",
        content: "这是本地 runtime 的远程镜像示例数据。",
        tags: ["demo"],
        pdfId: "demo-paper-1",
        createdAt: serverTime,
        updatedAt: serverTime,
      },
    ],
    highlights: [],
    graphProjects: [],
    graphNodes: [],
    graphEdges: [],
  }
}

export class HttpRemoteApiClient implements RemoteApiClient {
  constructor(private readonly config: RemoteApiConfig) {}

  async bootstrap(): Promise<RemoteBootstrapPayload> {
    void this.config
    return buildFallbackBootstrap()
  }
}

export interface StoredRemoteSettings {
  baseUrl: string
  accessToken: string | null
  updatedAt: string | null
}

const REMOTE_SETTINGS_KEY = "remote_api"

export function getRemoteSettings(): StoredRemoteSettings {
  const row = db.prepare(`
    SELECT value_json, updated_at
    FROM local_settings
    WHERE key = ?
  `).get(REMOTE_SETTINGS_KEY) as { value_json: string; updated_at: string } | undefined

  if (!row) {
    return {
      baseUrl: appConfig.remote?.baseUrl ?? "",
      accessToken: appConfig.remote?.accessToken ?? null,
      updatedAt: null,
    }
  }

  const parsed = JSON.parse(row.value_json) as { baseUrl?: string; accessToken?: string | null }
  return {
    baseUrl: parsed.baseUrl ?? "",
    accessToken: parsed.accessToken ?? null,
    updatedAt: row.updated_at,
  }
}

export function saveRemoteSettings(input: { baseUrl: string; accessToken?: string | null }) {
  const updatedAt = nowIso()
  const settings: StoredRemoteSettings = {
    baseUrl: input.baseUrl.trim(),
    accessToken: input.accessToken?.trim() || null,
    updatedAt,
  }

  db.prepare(`
    INSERT INTO local_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(
    REMOTE_SETTINGS_KEY,
    JSON.stringify({
      baseUrl: settings.baseUrl,
      accessToken: settings.accessToken,
    }),
    updatedAt,
  )

  return settings
}

export function buildReservedRemoteMessage(settings: StoredRemoteSettings) {
  if (!settings.baseUrl) {
    return "Remote API reserved. No sync implementation enabled."
  }
  return `Remote API reserved at ${settings.baseUrl}. Sync execution is not implemented.`
}
