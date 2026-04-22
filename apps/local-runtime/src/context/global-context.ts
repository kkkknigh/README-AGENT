export function buildGlobalContext() {
  return {
    scope: "global" as const,
    summary: "Global workspace context with no scoped document or workspace.",
  }
}
