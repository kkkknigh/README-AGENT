import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { nowIso } from "../services/time.js"

export interface AgentRunEventRecord {
  id: string
  runId: string
  seq: number
  eventType: string
  payloadJson: string
  createdAt: string
}

function mapRow(row: {
  id: string
  run_id: string
  seq: number
  event_type: string
  payload_json: string
  created_at: string
}): AgentRunEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    seq: row.seq,
    eventType: row.event_type,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
  }
}

export function createRunEvent(input: {
  runId: string
  seq: number
  eventType: string
  payloadJson: string
}) {
  const record: AgentRunEventRecord = {
    id: nanoid(),
    runId: input.runId,
    seq: input.seq,
    eventType: input.eventType,
    payloadJson: input.payloadJson,
    createdAt: nowIso(),
  }

  db.prepare(`
    INSERT INTO agent_run_events (id, run_id, seq, event_type, payload_json, created_at)
    VALUES (@id, @runId, @seq, @eventType, @payloadJson, @createdAt)
  `).run(record)

  return record
}

export function listRunEvents(runId: string) {
  const rows = db.prepare(`
    SELECT id, run_id, seq, event_type, payload_json, created_at
    FROM agent_run_events
    WHERE run_id = ?
    ORDER BY seq ASC
  `).all(runId) as Array<Parameters<typeof mapRow>[0]>

  return rows.map(mapRow)
}
