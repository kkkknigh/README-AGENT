import type { AgentRunMode, AgentRunRecord } from "../repositories/runs-repo.js"
import type { LocalChatThreadDto, WorkbenchContextDto } from "@readmeclaw/shared-ui"

export interface RuntimeRequestOverrides {
  model?: string | null
  apiBase?: string | null
  apiKey?: string | null
}

export interface AgentContext {
  scope: "global" | "workspace" | "document"
  thread: LocalChatThreadDto
  ideState: WorkbenchContextDto | null
  effectiveWorkspaceId: string | null
  effectiveDocumentId: string | null
  global?: Record<string, unknown>
  workspace?: Record<string, unknown>
  document?: Record<string, unknown>
  summary: string
}

export interface RuntimeExecutionInput {
  run: AgentRunRecord
  thread: LocalChatThreadDto
  mode: AgentRunMode
  userMessageId: string
  userInput: string
  history: Array<{ role: "user" | "assistant"; content: string }>
  overrides: RuntimeRequestOverrides
  attachedContext?: WorkbenchContextDto | null
}

export interface PlanningResult {
  kind: "answer" | "tool"
  thinking?: string
  answer?: string
  tool?: string
  args?: Record<string, unknown>
}
