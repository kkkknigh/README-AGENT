import { getWorkspaceDetail } from "../services/workspaces.js"

export function buildWorkspaceContext(workspaceId: string) {
  const detail = getWorkspaceDetail(workspaceId)
  return {
    scope: "workspace" as const,
    workspaceId,
    workspace: detail?.workspace ?? null,
    documents: detail?.documents ?? [],
    summary: detail
      ? `Workspace ${detail.workspace.name} with ${detail.documents.length} bound documents.`
      : `Workspace id: ${workspaceId}.`,
  }
}
