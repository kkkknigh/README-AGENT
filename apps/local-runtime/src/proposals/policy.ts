import type { AgentTool } from "../tools/types.js"

export function requiresApproval(tool: AgentTool) {
  if (tool.risk === "destructive") {
    throw new Error(`Tool ${tool.name} is not available in this runtime`)
  }
  return tool.requiresApproval || tool.risk === "mutating"
}
