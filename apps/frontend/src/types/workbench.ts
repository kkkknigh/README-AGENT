import type { WorkbenchContextDto, WorkbenchTabType } from "@readmeclaw/shared-ui"

export type ActivityId = "explorer" | "library" | "graph" | "search" | "profile"
export type PersistedWorkbenchTabType = Exclude<WorkbenchTabType, "welcome">
export type WorkbenchPanelId = "sidebar" | "aux" | "notes"

export type DocumentTabPayload = {
  documentId: string
}

export type NoteTabPayload = {
  pdfId: string
  noteId: number | null
  title?: string
  isNew?: boolean
}

export type GraphTabPayload = {
  workspaceId: string | null
  graphId: string
  mode: "global" | "workspace"
}

export type WelcomeTabPayload = {
  message?: string
}

export type WorkbenchTabPayloadMap = {
  welcome: WelcomeTabPayload
  document: DocumentTabPayload
  note: NoteTabPayload
  graph: GraphTabPayload
}

export type WorkbenchTab<T extends WorkbenchTabType = WorkbenchTabType> = {
  id: string
  type: T
  resourceRemoteId: string | null
  title: string
  payload: WorkbenchTabPayloadMap[T]
  createdAt?: string
  updatedAt?: string
}

export type WorkbenchChatContext = WorkbenchContextDto

export type WorkbenchLayoutState = {
  sidebarVisible: boolean
  sidebarWidth: number
  lastExpandedSidebarWidth: number
  auxPanelVisible: boolean
  auxPanelWidth: number
  lastExpandedAuxPanelWidth: number
  notesPaneVisible: boolean
  notesPaneHeight: number
  lastExpandedNotesPaneHeight: number
}
