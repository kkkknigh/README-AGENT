<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDocumentsQuery, useUploadMutation } from '../composables/queries/useLibraryQueries'
import { useDesktopApi } from '../composables/useDesktopApi'
import { useLibraryStore } from '../stores/library'
import { useWorkbenchStore } from '../stores/workbench'
import ActivityBar from '../components/workbench/ActivityBar.vue'
import EditorTabs from '../components/workbench/EditorTabs.vue'
import DocumentReaderTab from '../components/workbench/DocumentReaderTab.vue'
import NoteEditorTab from '../components/workbench/NoteEditorTab.vue'
import GraphTab from '../components/workbench/GraphTab.vue'
import ChatTab from '../components/chat-box/ChatTab.vue'
import SidebarTree from '../components/SidebarTree.vue'
import DocumentList from '../components/DocumentList.vue'
import UploadModal from '../components/sidebar/UploadModal.vue'
import type { WorkspaceDetailDto, WorkspaceNodeDto } from '@readmeclaw/shared-ui'
import type { WorkbenchTab } from '../types/workbench'

const route = useRoute()
const router = useRouter()
const desktopApi = useDesktopApi()
const workbenchStore = useWorkbenchStore()
const libraryStore = useLibraryStore()
const { data: documents } = useDocumentsQuery()
const uploadMutation = useUploadMutation()

const workspaceItems = ref<WorkspaceNodeDto[]>([])
const workspaceDetail = ref<WorkspaceDetailDto | null>(null)
const workspaceLoading = ref(false)
const sidebarQuery = ref('')
const showUploadModal = ref(false)

const filteredDocuments = computed(() => {
  const q = sidebarQuery.value.trim().toLowerCase()
  const items = documents.value || []
  if (!q) return items
  return items.filter((doc) =>
    doc.name.toLowerCase().includes(q) ||
    doc.tags?.some((tag) => tag.toLowerCase().includes(q)) ||
    doc.authors?.some((author) => author.toLowerCase().includes(q))
  )
})

const noteSearchResults = computed(() => {
  const q = sidebarQuery.value.trim().toLowerCase()
  if (!q) return []
  return (documents.value || [])
    .filter((doc) => doc.name.toLowerCase().includes(q))
    .slice(0, 8)
})

const activeTab = computed(() => workbenchStore.activeTab)
const activeDocumentTab = computed(() => activeTab.value?.type === 'document' ? activeTab.value as WorkbenchTab<'document'> : null)
const activeNoteTab = computed(() => activeTab.value?.type === 'note' ? activeTab.value as WorkbenchTab<'note'> : null)
const activeGraphTab = computed(() => activeTab.value?.type === 'graph' ? activeTab.value as WorkbenchTab<'graph'> : null)

async function loadWorkspaceTree() {
  const response = await desktopApi.listWorkspaces().catch(() => ({ items: [] }))
  workspaceItems.value = response.items
  if (!workbenchStore.selectedWorkspaceId && response.items.length > 0) {
    workbenchStore.setSelectedWorkspace(response.items[0]!.id)
  }
}

async function loadWorkspaceDetail(workspaceId: string | null) {
  if (!workspaceId) {
    workspaceDetail.value = null
    return
  }
  workspaceLoading.value = true
  try {
    workspaceDetail.value = await desktopApi.getWorkspaceDetail(workspaceId)
  } catch {
    workspaceDetail.value = null
  } finally {
    workspaceLoading.value = false
  }
}

function openDocument(documentId: string, title?: string) {
  const doc = (documents.value || []).find((item) => item.id === documentId)
  workbenchStore.openDocumentTab(documentId, title || doc?.name || documentId)
}

function openGraphTab() {
  workbenchStore.openGraphTab({
    title: workbenchStore.selectedWorkspaceId ? 'Workspace Graph' : 'Global Graph',
    workspaceId: workbenchStore.selectedWorkspaceId,
  })
}

function applyRouteIntent() {
  if (route.name === 'library') {
    workbenchStore.setActiveActivity('library')
  } else if (route.name === 'tag-graph') {
    workbenchStore.setActiveActivity('graph')
    openGraphTab()
  } else if (route.name === 'reader') {
    if (libraryStore.currentDocumentId) {
      const doc = (documents.value || []).find((item) => item.id === libraryStore.currentDocumentId)
      workbenchStore.openDocumentTab(libraryStore.currentDocumentId, doc?.name || 'Current Document')
    }
  } else {
    workbenchStore.setActiveActivity('explorer')
  }
}

async function handleUploadFile(file: File) {
  showUploadModal.value = false
  const result = await uploadMutation.mutateAsync(file)
  if (result.pdfId) {
    openDocument(result.pdfId, result.filename)
  }
}

function handleUploadLink(_url: string) {
  showUploadModal.value = false
}

watch(() => workbenchStore.selectedWorkspaceId, (workspaceId) => {
  loadWorkspaceDetail(workspaceId)
}, { immediate: true })

watch(activeTab, async (tab) => {
  if (tab?.type === 'document') {
    const currentId = activeDocumentTab.value?.payload.documentId
    if (!currentId) return
    if (libraryStore.currentDocumentId !== currentId) {
      await libraryStore.selectDocument(currentId)
    }
  }
})

watch(() => route.fullPath, () => {
  applyRouteIntent()
})

watch(() => documents.value, () => {
  applyRouteIntent()
}, { immediate: true })

onMounted(async () => {
  await workbenchStore.hydrate()
  await loadWorkspaceTree()
  applyRouteIntent()
})
</script>

<template>
  <div class="workbench">
    <ActivityBar :active="workbenchStore.activeActivity" @select="workbenchStore.setActiveActivity" />

    <aside
      v-show="workbenchStore.secondarySidebarVisible"
      class="workbench__sidebar"
      :style="{ width: `${workbenchStore.secondarySidebarWidth}px` }"
    >
      <div class="workbench__sidebar-header">
        <div class="workbench__sidebar-title">{{ workbenchStore.activeActivity }}</div>
        <button
          v-if="workbenchStore.activeActivity === 'library'"
          class="workbench__sidebar-action"
          @click="showUploadModal = true"
        >
          Upload
        </button>
      </div>

      <template v-if="workbenchStore.activeActivity === 'explorer'">
        <div class="workbench__pane">
          <SidebarTree
            :items="workspaceItems"
            :selected-id="workbenchStore.selectedWorkspaceId"
            @select="workbenchStore.setSelectedWorkspace"
          />
          <div class="workbench__pane-divider"></div>
          <div v-if="workspaceLoading" class="workbench__empty">Loading workspace…</div>
          <DocumentList v-else :detail="workspaceDetail" @open-document="openDocument" />
          <button class="workbench__pane-cta" @click="openGraphTab">Open Graph</button>
        </div>
      </template>

      <template v-else-if="workbenchStore.activeActivity === 'library'">
        <div class="workbench__pane">
          <input v-model="sidebarQuery" class="workbench__search" placeholder="Search library..." />
          <button
            v-for="doc in filteredDocuments"
            :key="doc.id"
            class="workbench__list-item"
            @click="openDocument(doc.id, doc.name)"
          >
            <strong>{{ doc.name }}</strong>
            <span>{{ doc.authors?.join(' / ') || 'Unknown authors' }}</span>
          </button>
        </div>
      </template>

      <template v-else-if="workbenchStore.activeActivity === 'graph'">
        <div class="workbench__pane">
          <button class="workbench__pane-cta" @click="openGraphTab">Open Global Graph</button>
          <button
            v-if="workbenchStore.selectedWorkspaceId"
            class="workbench__pane-cta"
            @click="openGraphTab"
          >
            Open Workspace Graph
          </button>
        </div>
      </template>

      <template v-else-if="workbenchStore.activeActivity === 'search'">
        <div class="workbench__pane">
          <input v-model="sidebarQuery" class="workbench__search" placeholder="Search docs..." />
          <button
            v-for="doc in noteSearchResults"
            :key="doc.id"
            class="workbench__list-item"
            @click="openDocument(doc.id, doc.name)"
          >
            <strong>{{ doc.name }}</strong>
            <span>Open matching document</span>
          </button>
        </div>
      </template>

      <template v-else>
        <div class="workbench__pane">
          <button class="workbench__pane-cta" @click="router.push('/profile')">Open Profile</button>
        </div>
      </template>
    </aside>

    <main class="workbench__main">
      <EditorTabs
        :tabs="workbenchStore.openTabs"
        :active-tab-id="workbenchStore.activeTabId"
        @activate="workbenchStore.activateTab"
        @close="workbenchStore.closeTab"
        @close-others="workbenchStore.closeOtherTabs"
      />

      <div class="workbench__content">
        <div class="workbench__editor">
          <div v-if="activeTab?.type === 'welcome'" class="workbench__welcome">
            <h1>READMEClaw Desktop</h1>
            <p>Explorer, library, graph and chat are now integrated into one workbench.</p>
          </div>

          <DocumentReaderTab
            v-else-if="activeDocumentTab"
            :document-id="activeDocumentTab.payload.documentId"
            @open-note="workbenchStore.openNoteTab"
          />

          <NoteEditorTab
            v-else-if="activeNoteTab"
            :pdf-id="activeNoteTab.payload.pdfId"
            :note-id="activeNoteTab.payload.noteId"
            :title="activeNoteTab.title"
            :is-new="activeNoteTab.payload.isNew"
            @title-change="workbenchStore.updateTabTitle(activeNoteTab.id, $event)"
            @deleted="workbenchStore.closeTab(activeNoteTab.id)"
            @saved="workbenchStore.updateTab(activeNoteTab.id, { title: $event.title, resourceRemoteId: $event.noteId != null ? String($event.noteId) : null, payload: { ...activeNoteTab.payload, noteId: $event.noteId, title: $event.title, isNew: false } })"
          />

          <GraphTab
            v-else-if="activeGraphTab"
            :workspace-id="activeGraphTab.payload.workspaceId"
          />
        </div>

        <aside class="workbench__chat" :style="{ width: `${workbenchStore.chatWidth}px` }">
          <div class="workbench__chat-header">AI Chat</div>
          <div class="workbench__chat-body">
            <ChatTab
              :scope="workbenchStore.rightChatContext.scope"
              :workspace-id="workbenchStore.rightChatContext.workspaceId"
              :document-remote-id="workbenchStore.rightChatContext.documentRemoteId"
              :active-resource-type="workbenchStore.rightChatContext.activeResourceType"
            />
          </div>
        </aside>
      </div>

      <footer class="workbench__statusbar">
        <span>{{ workbenchStore.activeActivity }}</span>
        <span v-if="workbenchStore.selectedWorkspaceId">workspace: {{ workbenchStore.selectedWorkspaceId }}</span>
        <span>{{ workbenchStore.openTabs.length }} tabs</span>
      </footer>
    </main>

    <UploadModal
      v-if="showUploadModal"
      @close="showUploadModal = false"
      @file="handleUploadFile"
      @link="handleUploadLink"
    />
  </div>
</template>

<style scoped>
.workbench {
  height: 100vh;
  display: grid;
  grid-template-columns: 52px minmax(240px, auto) minmax(0, 1fr);
  background: var(--c-bg-page);
}

.workbench__sidebar {
  display: flex;
  flex-direction: column;
  min-width: 240px;
  background: var(--c-sidebar-bg);
  background-image: linear-gradient(180deg, var(--c-sidebar-bg-start), var(--c-sidebar-bg-end));
  border-right: var(--border-width) solid var(--c-sidebar-border);
}

.workbench__sidebar-header {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: var(--border-width) solid var(--c-sidebar-border);
}

.workbench__sidebar-title {
  color: var(--c-sidebar-text);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.workbench__sidebar-action,
.workbench__pane-cta {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--c-accent-bg);
  color: var(--c-accent);
  border: var(--border-width) solid var(--c-accent-border);
  font-size: 12px;
  font-weight: 600;
}

.workbench__pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow: auto;
}

.workbench__pane-divider {
  height: 1px;
  background: var(--c-sidebar-border);
  margin: 6px 0;
}

.workbench__search {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--c-bg-input);
  border: var(--border-width) solid var(--c-border-input);
  color: var(--c-text-primary);
}

.workbench__list-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  text-align: left;
  border-radius: 10px;
  background: var(--c-sidebar-bg-hover);
  color: var(--c-sidebar-text);
}

.workbench__list-item span {
  color: var(--c-sidebar-text-subtle);
  font-size: 12px;
}

.workbench__main {
  min-width: 0;
  display: grid;
  grid-template-rows: 40px minmax(0, 1fr) 24px;
}

.workbench__content {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
}

.workbench__editor {
  min-width: 0;
  min-height: 0;
  background: var(--c-bg-primary);
}

.workbench__welcome {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--c-text-secondary);
}

.workbench__chat {
  min-width: 320px;
  display: flex;
  flex-direction: column;
  border-left: var(--border-width) solid var(--c-border-light);
  background: var(--c-bg-elevated);
}

.workbench__chat-header {
  height: 40px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-bottom: var(--border-width) solid var(--c-border-light);
  color: var(--c-text-secondary);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.workbench__chat-body {
  flex: 1;
  min-height: 0;
}

.workbench__statusbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 12px;
  background: var(--c-bg-elevated);
  border-top: var(--border-width) solid var(--c-border-light);
  color: var(--c-text-muted);
  font-size: 11px;
}

.workbench__empty {
  padding: 12px;
  color: var(--c-text-muted);
  font-size: 12px;
}
</style>
