export type AgentStreamEvent =
  | { type: "run_started"; runId: string; sessionId: string }
  | { type: "user_message_ack"; userMessageId: string | number }
  | { type: "thinking"; text: string }
  | { type: "step"; step: string; status?: "running" | "done" }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; summary: string }
  | { type: "proposal"; proposal: Record<string, unknown> }
  | { type: "mutation"; resource: string; action: string; detail?: Record<string, unknown> }
  | { type: "chunk"; delta: string }
  | { type: "final"; response: string; sessionId: string; runId: string; citations?: Array<Record<string, unknown>>; context_used?: Record<string, unknown> }
  | { type: "error"; error: string; runId?: string; sessionId?: string }
