import { db } from "../db/index.js"
import { nowIso } from "../services/time.js"

export interface MessageMetaRecord {
  messageId: string
  runId: string | null
  citationsJson: string | null
  thoughtsJson: string | null
  stepsJson: string | null
  attachmentsJson: string | null
  ideStateJson: string | null
  updatedAt: string
}

export function upsertMessageMeta(input: {
  messageId: string
  runId?: string | null
  citationsJson?: string | null
  thoughtsJson?: string | null
  stepsJson?: string | null
  attachmentsJson?: string | null
  ideStateJson?: string | null
}) {
  const record: MessageMetaRecord = {
    messageId: input.messageId,
    runId: input.runId ?? null,
    citationsJson: input.citationsJson ?? null,
    thoughtsJson: input.thoughtsJson ?? null,
    stepsJson: input.stepsJson ?? null,
    attachmentsJson: input.attachmentsJson ?? null,
    ideStateJson: input.ideStateJson ?? null,
    updatedAt: nowIso(),
  }

  db.prepare(`
    INSERT INTO local_chat_message_meta (
      message_id, run_id, citations_json, thoughts_json, steps_json, attachments_json, ide_state_json, updated_at
    ) VALUES (
      @messageId, @runId, @citationsJson, @thoughtsJson, @stepsJson, @attachmentsJson, @ideStateJson, @updatedAt
    )
    ON CONFLICT(message_id) DO UPDATE SET
      run_id = excluded.run_id,
      citations_json = excluded.citations_json,
      thoughts_json = excluded.thoughts_json,
      steps_json = excluded.steps_json,
      attachments_json = excluded.attachments_json,
      ide_state_json = excluded.ide_state_json,
      updated_at = excluded.updated_at
  `).run(record)

  return record
}
