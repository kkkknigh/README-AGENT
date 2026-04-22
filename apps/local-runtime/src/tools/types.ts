import type { AgentContext } from "../agent-runtime/types.js"

export type ToolRisk = "readonly" | "mutating" | "destructive"

export interface ToolExecutionResult {
  summary: string
  data: unknown
  citations?: Array<Record<string, unknown>>
}

export interface AgentTool {
  name: string
  description: string
  risk: ToolRisk
  requiresApproval: boolean
  actionType: string
  actionTypeLabel: string
  execute: (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolExecutionResult> | ToolExecutionResult
}
