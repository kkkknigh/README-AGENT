import type { AgentContext } from "./types.js"
import { getTool } from "../tools/registry.js"

export async function dispatchToolCall(input: {
  ctx: AgentContext
  toolName: string
  args: Record<string, unknown>
}) {
  const tool = getTool(input.toolName)
  if (!tool) {
    throw new Error(`Unknown tool: ${input.toolName}`)
  }

  const result = await tool.execute(input.ctx, input.args)
  return { tool, result }
}
