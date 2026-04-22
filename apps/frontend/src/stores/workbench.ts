import { defineStore } from "pinia"
import { computed, reactive, ref, watch } from "vue"
import { useDesktopApi } from "../composables/useDesktopApi"
import type { WorkbenchTabDto } from "@readmeclaw/shared-ui"
import type {
  ActivityId,
  DocumentTabPayload,
  GraphTabPayload,
  NoteTabPayload,
  PersistedWorkbenchTabType,
  WorkbenchChatContext,
  WorkbenchLayoutState,
  WorkbenchTab,
} from "../types/workbench"

const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 420
const AUX_MIN = 320
const AUX_MAX = 560
const NOTES_MIN = 140
const NOTES_MAX = 320
const LAYOUT_STORAGE_KEY = "readme_workbench_layout_v3"

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function parsePayload(tab: WorkbenchTabDto): WorkbenchTab["payload"] {
  try {
    return JSON.parse(tab.payloadJson)
  } catch {
    return {}
  }
}

function toTab(tab: WorkbenchTabDto): WorkbenchTab<PersistedWorkbenchTabType> | null {
  if (tab.type === "welcome") return null
  return {
    id: tab.id,
    type: tab.type,
    resourceRemoteId: tab.resourceRemoteId,
    title: tab.title,
    payload: parsePayload(tab) as any,
    createdAt: tab.createdAt,
    updatedAt: tab.updatedAt,
  }
}

function serializeTabs(tabs: WorkbenchTab<PersistedWorkbenchTabType>[]) {
  return tabs.map((tab) => ({
    id: tab.id,
    type: tab.type,
    resourceRemoteId: tab.resourceRemoteId,
    title: tab.title,
    payloadJson: JSON.stringify(tab.payload ?? {}),
  }))
}

function isDocumentTab(tab: WorkbenchTab<PersistedWorkbenchTabType>): tab is WorkbenchTab<"document"> {
  return tab.type === "document"
}

function isNoteTab(tab: WorkbenchTab<PersistedWorkbenchTabType>): tab is WorkbenchTab<"note"> {
  return tab.type === "note"
}

function isGraphTab(tab: WorkbenchTab<PersistedWorkbenchTabType>): tab is WorkbenchTab<"graph"> {
  return tab.type === "graph"
}

function loadLayoutState(): WorkbenchLayoutState {
  const fallback: WorkbenchLayoutState = {
    sidebarVisible: true,
    sidebarWidth: 300,
    lastExpandedSidebarWidth: 300,
    auxPanelVisible: false,
    auxPanelWidth: 420,
    lastExpandedAuxPanelWidth: 420,
    notesPaneVisible: true,
    notesPaneHeight: 180,
    lastExpandedNotesPaneHeight: 180,
  }

  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<WorkbenchLayoutState>
    return {
      sidebarVisible: parsed.sidebarVisible ?? fallback.sidebarVisible,
      sidebarWidth: clamp(Number(parsed.sidebarWidth ?? fallback.sidebarWidth), SIDEBAR_MIN, SIDEBAR_MAX),
      lastExpandedSidebarWidth: clamp(Number(parsed.lastExpandedSidebarWidth ?? parsed.sidebarWidth ?? fallback.lastExpandedSidebarWidth), SIDEBAR_MIN, SIDEBAR_MAX),
      auxPanelVisible: parsed.auxPanelVisible ?? fallback.auxPanelVisible,
      auxPanelWidth: clamp(Number(parsed.auxPanelWidth ?? fallback.auxPanelWidth), AUX_MIN, AUX_MAX),
      lastExpandedAuxPanelWidth: clamp(Number(parsed.lastExpandedAuxPanelWidth ?? parsed.auxPanelWidth ?? fallback.lastExpandedAuxPanelWidth), AUX_MIN, AUX_MAX),
      notesPaneVisible: parsed.notesPaneVisible ?? fallback.notesPaneVisible,
      notesPaneHeight: clamp(Number(parsed.notesPaneHeight ?? fallback.notesPaneHeight), NOTES_MIN, NOTES_MAX),
      lastExpandedNotesPaneHeight: clamp(Number(parsed.lastExpandedNotesPaneHeight ?? parsed.notesPaneHeight ?? fallback.lastExpandedNotesPaneHeight), NOTES_MIN, NOTES_MAX),
    }
  } catch {
    return fallback
  }
}

export const useWorkbenchStore = defineStore("workbench", () => {
  const api = useDesktopApi()
  const activeActivity = ref<ActivityId>("explorer")
  const selectedWorkspaceId = ref<string | null>(null)
  const openTabs = ref<WorkbenchTab<PersistedWorkbenchTabType>[]>([])
  const activeTabId = ref<string | null>(null)
  const isHydrated = ref(false)
  const layout = reactive<WorkbenchLayoutState>(loadLayoutState())

  let persistTimer: ReturnType<typeof setTimeout> | null = null

  const activeTab = computed(() => openTabs.value.find((tab) => tab.id === activeTabId.value) ?? null)

  const rightChatContext = computed<WorkbenchChatContext>(() => {
    const tab = activeTab.value
    if (!tab) {
      return {
        scope: selectedWorkspaceId.value ? "workspace" : "global",
        workspaceId: selectedWorkspaceId.value,
        documentRemoteId: null,
        activeResourceType: null,
      }
    }

    if (tab.type === "document") {
      const payload = tab.payload as DocumentTabPayload
      return {
        scope: "document",
        workspaceId: selectedWorkspaceId.value,
        documentRemoteId: payload.documentId,
        activeResourceType: "document",
      }
    }

    if (tab.type === "note") {
      const payload = tab.payload as NoteTabPayload
      return {
        scope: payload.pdfId ? "document" : (selectedWorkspaceId.value ? "workspace" : "global"),
        workspaceId: selectedWorkspaceId.value,
        documentRemoteId: payload.pdfId ?? null,
        activeResourceType: "note",
      }
    }

    return {
      scope: selectedWorkspaceId.value ? "workspace" : "global",
      workspaceId: selectedWorkspaceId.value,
      documentRemoteId: null,
      activeResourceType: tab.type,
    }
  })

  watch(layout, (value) => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(value))
  }, { deep: true })

  function schedulePersist() {
    if (!isHydrated.value) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      api.saveTabs(serializeTabs(openTabs.value)).catch(console.warn)
    }, 250)
  }

  async function hydrate() {
    if (isHydrated.value) return
    const response = await api.listTabs().catch(() => ({ items: [] }))
    openTabs.value = response.items.map(toTab).filter((tab): tab is WorkbenchTab<PersistedWorkbenchTabType> => tab !== null)
    activeTabId.value = openTabs.value[openTabs.value.length - 1]?.id ?? null
    isHydrated.value = true
    if (response.items.length !== openTabs.value.length) {
      schedulePersist()
    }
  }

  function setActiveActivity(activity: ActivityId) {
    activeActivity.value = activity
  }

  function selectActivity(activity: ActivityId) {
    if (activeActivity.value === activity) {
      toggleSidebar()
      return
    }
    activeActivity.value = activity
    showSidebar()
  }

  function setSelectedWorkspace(workspaceId: string | null) {
    selectedWorkspaceId.value = workspaceId
  }

  function activateTab(tabId: string) {
    activeTabId.value = tabId
  }

  function upsertTab(next: WorkbenchTab<PersistedWorkbenchTabType>) {
    const existing = openTabs.value.find((tab) => tab.id === next.id)
    if (existing) {
      Object.assign(existing, next)
    } else {
      openTabs.value.push(next)
    }
    activeTabId.value = next.id
    schedulePersist()
  }

  function focusExisting(predicate: (tab: WorkbenchTab<PersistedWorkbenchTabType>) => boolean) {
    const existing = openTabs.value.find(predicate)
    if (!existing) return null
    activeTabId.value = existing.id
    return existing
  }

  function openDocumentTab(documentId: string, title: string) {
    const existing = focusExisting((tab) => isDocumentTab(tab) && tab.payload.documentId === documentId)
    if (existing) return existing

    const tab: WorkbenchTab<"document"> = {
      id: `document:${documentId}`,
      type: "document",
      resourceRemoteId: documentId,
      title,
      payload: { documentId },
    }
    upsertTab(tab)
    return tab
  }

  function openNoteTab(input: { pdfId: string; noteId: number | null; title: string; isNew?: boolean }) {
    const existing = input.noteId != null
      ? focusExisting((tab) => isNoteTab(tab) && tab.payload.noteId === input.noteId)
      : null
    if (existing) return existing

    const id = input.noteId != null ? `note:${input.noteId}` : `note:new:${input.pdfId}`
    const tab: WorkbenchTab<"note"> = {
      id,
      type: "note",
      resourceRemoteId: input.noteId != null ? String(input.noteId) : null,
      title: input.title,
      payload: {
        pdfId: input.pdfId,
        noteId: input.noteId,
        title: input.title,
        isNew: input.isNew,
      },
    }
    upsertTab(tab)
    return tab
  }

  function openGraphTab(input: { title: string; workspaceId?: string | null; graphId?: string }) {
    const graphId = input.graphId ?? (input.workspaceId ? `workspace:${input.workspaceId}` : "__tags__")
    const existing = focusExisting((tab) => isGraphTab(tab) && tab.payload.graphId === graphId)
    if (existing) return existing

    const tab: WorkbenchTab<"graph"> = {
      id: `graph:${graphId}`,
      type: "graph",
      resourceRemoteId: graphId,
      title: input.title,
      payload: {
        graphId,
        workspaceId: input.workspaceId ?? null,
        mode: input.workspaceId ? "workspace" : "global",
      },
    }
    upsertTab(tab)
    return tab
  }

  function closeTab(tabId: string) {
    const index = openTabs.value.findIndex((tab) => tab.id === tabId)
    if (index === -1) return
    openTabs.value.splice(index, 1)
    api.closeTab(tabId).catch(() => {})
    if (activeTabId.value === tabId) {
      activeTabId.value = openTabs.value[index]?.id ?? openTabs.value[index - 1]?.id ?? null
    }
    schedulePersist()
  }

  function closeOtherTabs(tabId: string) {
    openTabs.value = openTabs.value.filter((tab) => tab.id === tabId)
    activeTabId.value = tabId
    schedulePersist()
  }

  function updateTabTitle(tabId: string, title: string) {
    const target = openTabs.value.find((tab) => tab.id === tabId)
    if (!target) return
    target.title = title
    schedulePersist()
  }

  function updateTab(tabId: string, patch: Partial<WorkbenchTab<PersistedWorkbenchTabType>>) {
    const target = openTabs.value.find((tab) => tab.id === tabId)
    if (!target) return
    Object.assign(target, patch)
    if (patch.payload && isNoteTab(target)) {
      target.resourceRemoteId = target.payload.noteId != null
        ? String(target.payload.noteId)
        : target.resourceRemoteId
    }
    api.updateTabState(tabId, {
      title: target.title,
      resourceRemoteId: target.resourceRemoteId,
      payloadJson: JSON.stringify(target.payload ?? {}),
    }).catch(console.warn)
    schedulePersist()
  }

  function setSidebarWidth(width: number) {
    const next = clamp(width, SIDEBAR_MIN, SIDEBAR_MAX)
    layout.sidebarWidth = next
    layout.lastExpandedSidebarWidth = next
  }

  function showSidebar() {
    layout.sidebarVisible = true
    layout.sidebarWidth = clamp(layout.lastExpandedSidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX)
  }

  function hideSidebar() {
    layout.sidebarVisible = false
  }

  function toggleSidebar(force?: boolean) {
    const nextVisible = force ?? !layout.sidebarVisible
    if (nextVisible) {
      showSidebar()
      return
    }
    hideSidebar()
  }

  function setAuxPanelWidth(width: number) {
    const next = clamp(width, AUX_MIN, AUX_MAX)
    layout.auxPanelWidth = next
    layout.lastExpandedAuxPanelWidth = next
  }

  function showAuxPanel() {
    layout.auxPanelVisible = true
    layout.auxPanelWidth = clamp(layout.lastExpandedAuxPanelWidth, AUX_MIN, AUX_MAX)
  }

  function hideAuxPanel() {
    layout.auxPanelVisible = false
  }

  function toggleAuxPanel(force?: boolean) {
    const nextVisible = force ?? !layout.auxPanelVisible
    if (nextVisible) {
      showAuxPanel()
      return
    }
    hideAuxPanel()
  }

  function setNotesPaneHeight(height: number) {
    const next = clamp(height, NOTES_MIN, NOTES_MAX)
    layout.notesPaneHeight = next
    layout.lastExpandedNotesPaneHeight = next
  }

  function showNotesPane() {
    layout.notesPaneVisible = true
    layout.notesPaneHeight = clamp(layout.lastExpandedNotesPaneHeight, NOTES_MIN, NOTES_MAX)
  }

  function hideNotesPane() {
    layout.notesPaneVisible = false
  }

  function toggleNotesPane(force?: boolean) {
    const nextVisible = force ?? !layout.notesPaneVisible
    if (nextVisible) {
      showNotesPane()
      return
    }
    hideNotesPane()
  }

  function handleResponsiveWidth(width: number) {
    if (width < 1180 && layout.auxPanelVisible) {
      hideAuxPanel()
    }
    if (width < 920 && layout.sidebarVisible) {
      hideSidebar()
    }
  }

  return {
    activeActivity,
    selectedWorkspaceId,
    openTabs,
    activeTabId,
    activeTab,
    rightChatContext,
    layout,
    isHydrated,
    hydrate,
    setActiveActivity,
    selectActivity,
    setSelectedWorkspace,
    activateTab,
    openDocumentTab,
    openNoteTab,
    openGraphTab,
    closeTab,
    closeOtherTabs,
    updateTabTitle,
    updateTab,
    setSidebarWidth,
    showSidebar,
    hideSidebar,
    toggleSidebar,
    setAuxPanelWidth,
    showAuxPanel,
    hideAuxPanel,
    toggleAuxPanel,
    setNotesPaneHeight,
    showNotesPane,
    hideNotesPane,
    toggleNotesPane,
    handleResponsiveWidth,
  }
})
