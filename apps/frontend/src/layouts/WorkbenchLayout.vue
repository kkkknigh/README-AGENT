<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDocumentsQuery, useUploadMutation } from '../composables/queries/useLibraryQueries'
import { useProfileQuery, useStatsQuery, useUpdateProfileMutation } from '../composables/queries/useProfileQueries'
import { useDesktopApi } from '../composables/useDesktopApi'
import { useAuthStore } from '../stores/auth'
import { useLibraryStore } from '../stores/library'
import { useProfileStore } from '../stores/profile'
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
import WorkbenchEmptyState from '../components/common/WorkbenchEmptyState.vue'
import type { WorkspaceDetailDto, WorkspaceNodeDto } from '@readmeclaw/shared-ui'
import type { WorkbenchTab } from '../types/workbench'

const route = useRoute()
const desktopApi = useDesktopApi()
const authStore = useAuthStore()
const workbenchStore = useWorkbenchStore()
const libraryStore = useLibraryStore()
const profileStore = useProfileStore()
const { data: documents } = useDocumentsQuery()
const { data: profile } = useProfileQuery()
const { data: stats } = useStatsQuery()
const updateProfileMutation = useUpdateProfileMutation()
const uploadMutation = useUploadMutation()

const rootRef = ref<HTMLElement | null>(null)
const workspaceItems = ref<WorkspaceNodeDto[]>([])
const workspaceDetail = ref<WorkspaceDetailDto | null>(null)
const workspaceLoading = ref(false)
const sidebarQuery = ref('')
const showUploadModal = ref(false)
const profileEditMode = ref(false)
const profileSaveError = ref('')
const profileEditForm = ref({
  username: '',
  bio: '',
  defaultTranslationLang: 'zh',
})

let stopLayoutResize: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null

const onOpenUpload = () => {
  showUploadModal.value = true
}

const activityLabels: Record<string, string> = {
  explorer: 'Explorer',
  library: 'Library',
  graph: 'Graph',
  search: 'Search',
  profile: 'Profile',
}

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

const workbenchStyle = computed(() => ({
  gridTemplateColumns: workbenchStore.layout.sidebarVisible
    ? `52px ${workbenchStore.layout.sidebarWidth}px 4px minmax(0, 1fr)`
    : '52px minmax(0, 1fr)',
}))

const contentStyle = computed(() => ({
  gridTemplateColumns: workbenchStore.layout.auxPanelVisible
    ? `minmax(0, 1fr) 4px ${workbenchStore.layout.auxPanelWidth}px`
    : 'minmax(0, 1fr)',
}))

const currentSidebarTitle = computed(() => activityLabels[workbenchStore.activeActivity] ?? 'Workspace')
const translationLangOptions = [
  { value: 'zh', label: 'Chinese' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
]
const profileIdentity = computed(() => ({
  username: profile.value?.username || authStore.user.username,
  email: profile.value?.email || authStore.user.email,
  bio: profile.value?.bio?.trim() || null,
  createdAt: profile.value?.createdAt || null,
}))
const profileInitial = computed(() => profileIdentity.value.username.charAt(0).toUpperCase() || '?')
const profileJoinedLabel = computed(() => {
  if (!profileIdentity.value.createdAt) return 'Local workspace account'
  return new Date(profileIdentity.value.createdAt).toLocaleDateString('zh-CN')
})
const profileLanguageLabel = computed(() => {
  const lang = profile.value?.preferences?.defaultTranslationLang
  const labels: Record<string, string> = {
    zh: 'Chinese',
    en: 'English',
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
  }
  return labels[lang] ?? 'Chinese'
})
const profileQuickStats = computed(() => {
  if (!stats.value) return []
  return [
    { label: 'Docs', value: stats.value.paperCount },
    { label: 'Notes', value: stats.value.noteCount },
    { label: 'Chats', value: stats.value.chatCount },
    { label: 'Graphs', value: stats.value.graphCount },
  ]
})

function startProfileEdit() {
  profileSaveError.value = ''
  profileEditForm.value = {
    username: profileIdentity.value.username,
    bio: profileIdentity.value.bio || '',
    defaultTranslationLang: profile.value?.preferences?.defaultTranslationLang || 'zh',
  }
  profileEditMode.value = true
}

function cancelProfileEdit() {
  profileEditMode.value = false
  profileSaveError.value = ''
}

async function saveProfileFromSidebar() {
  const username = profileEditForm.value.username.trim()
  if (!username) {
    profileSaveError.value = 'Username is required.'
    return
  }

  try {
    await updateProfileMutation.mutateAsync({
      username,
      bio: profileEditForm.value.bio.trim() || null,
      preferences: {
        ...(profile.value?.preferences || {}),
        defaultTranslationLang: profileEditForm.value.defaultTranslationLang,
      },
    })
    profileEditMode.value = false
    profileSaveError.value = ''
  } catch (error: any) {
    profileSaveError.value = error?.response?.data?.error || 'Failed to save profile.'
  }
}

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

function openGraphTab(mode: 'workspace' | 'global' = 'workspace') {
  const useWorkspace = mode === 'workspace' && workbenchStore.selectedWorkspaceId
  workbenchStore.openGraphTab({
    title: useWorkspace ? 'Workspace Graph' : 'Global Graph',
    workspaceId: useWorkspace ? workbenchStore.selectedWorkspaceId : null,
  })
}

function openUpload() {
  showUploadModal.value = true
}

async function createWorkspace() {
  const name = window.prompt('Workspace name')
  const nextName = name?.trim()
  if (!nextName) return
  try {
    const workspace = await desktopApi.createWorkspace({ name: nextName })
    await loadWorkspaceTree()
    workbenchStore.setSelectedWorkspace(workspace.id)
    workbenchStore.setActiveActivity('explorer')
    workbenchStore.showSidebar()
  } catch (error) {
    console.warn('Failed to create workspace', error)
  }
}

function applyRouteIntent() {
  if (route.name === 'library') {
    workbenchStore.setActiveActivity('library')
    workbenchStore.showSidebar()
    return
  }

  if (route.name === 'profile') {
    workbenchStore.setActiveActivity('profile')
    workbenchStore.showSidebar()
    return
  }

  if (route.name === 'tag-graph') {
    workbenchStore.setActiveActivity('graph')
    workbenchStore.showSidebar()
    openGraphTab('global')
    return
  }

  if (route.name === 'reader') {
    if (libraryStore.currentDocumentId) {
      const doc = (documents.value || []).find((item) => item.id === libraryStore.currentDocumentId)
      workbenchStore.openDocumentTab(libraryStore.currentDocumentId, doc?.name || 'Current Document')
    }
    return
  }

  workbenchStore.setActiveActivity('explorer')
  workbenchStore.showSidebar()
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

function startLayoutResize(event: MouseEvent, panel: 'sidebar' | 'aux') {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = panel === 'sidebar'
    ? workbenchStore.layout.sidebarWidth
    : workbenchStore.layout.auxPanelWidth

  const onMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX
    if (panel === 'sidebar') {
      workbenchStore.setSidebarWidth(startWidth + delta)
      return
    }
    workbenchStore.setAuxPanelWidth(startWidth - delta)
  }

  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    stopLayoutResize = null
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  stopLayoutResize = onUp
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

  window.addEventListener('workbench-open-upload', onOpenUpload)

  if (rootRef.value) {
    workbenchStore.handleResponsiveWidth(rootRef.value.clientWidth)
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        workbenchStore.handleResponsiveWidth(entry.contentRect.width)
      }
    })
    resizeObserver.observe(rootRef.value)
  }

})

onBeforeUnmount(() => {
  window.removeEventListener('workbench-open-upload', onOpenUpload)
  stopLayoutResize?.()
  resizeObserver?.disconnect()
})
</script>

<template>
  <div ref="rootRef" class="workbench" :style="workbenchStyle">
    <ActivityBar
      :active="workbenchStore.activeActivity"
      :sidebar-visible="workbenchStore.layout.sidebarVisible"
      :aux-visible="workbenchStore.layout.auxPanelVisible"
      @select="workbenchStore.selectActivity"
      @toggle-aux-panel="workbenchStore.toggleAuxPanel()"
    />

    <aside v-if="workbenchStore.layout.sidebarVisible" class="workbench__sidebar">
      <div class="workbench__sidebar-header">
        <div class="workbench__sidebar-title">{{ currentSidebarTitle }}</div>
        <div class="workbench__sidebar-actions">
          <button
            v-if="workbenchStore.activeActivity === 'library'"
            class="workbench__sidebar-action"
            @click="openUpload"
          >
            Upload
          </button>
          <button
            class="workbench__sidebar-icon"
            title="Collapse Sidebar"
            @click="workbenchStore.hideSidebar()"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <template v-if="workbenchStore.activeActivity === 'explorer'">
        <div class="workbench__pane">
          <template v-if="workspaceItems.length === 0">
            <WorkbenchEmptyState
              compact
              eyebrow="Explorer"
              title="No workspace yet"
              description="Create a workspace to organize documents, notes, and graph views."
              primary-label="Create Workspace"
              @primary="createWorkspace"
            />
          </template>
          <template v-else>
            <SidebarTree
              :items="workspaceItems"
              :selected-id="workbenchStore.selectedWorkspaceId"
              @select="workbenchStore.setSelectedWorkspace"
            />
            <div class="workbench__pane-divider"></div>
            <WorkbenchEmptyState
              v-if="workspaceLoading"
              compact
              eyebrow="Explorer"
              title="Loading workspace"
              description="Fetching the latest workspace structure and document bindings."
            />
            <WorkbenchEmptyState
              v-else-if="!workspaceDetail"
              compact
              eyebrow="Explorer"
              title="Select a workspace"
              description="Choose a workspace from the tree to inspect its bound documents and open the related graph."
            />
            <WorkbenchEmptyState
              v-else-if="workspaceDetail.documents.length === 0"
              compact
              eyebrow="Explorer"
              title="No documents in this workspace"
              description="Open the library to add a document, then come back here to keep working in context."
              primary-label="Open Graph"
              @primary="openGraphTab('workspace')"
            />
            <DocumentList v-else :detail="workspaceDetail" @open-document="openDocument" />
            <button class="workbench__pane-cta" @click="openGraphTab('workspace')">Open Graph</button>
          </template>
        </div>
      </template>

      <template v-else-if="workbenchStore.activeActivity === 'library'">
        <div class="workbench__pane">
          <input v-model="sidebarQuery" class="workbench__search" placeholder="Search library..." />
          <WorkbenchEmptyState
            v-if="(documents || []).length === 0"
            compact
            eyebrow="Library"
            title="Library is empty"
            description="Upload a document to start reading, annotating, and chatting in context."
            primary-label="Upload Document"
            @primary="openUpload"
          />
          <WorkbenchEmptyState
            v-else-if="filteredDocuments.length === 0"
            compact
            eyebrow="Library"
            title="No matching documents"
            description="Try a different search term or upload a new document."
            primary-label="Clear Search"
            secondary-label="Upload Document"
            @primary="sidebarQuery = ''"
            @secondary="openUpload"
          />
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
          <WorkbenchEmptyState
            compact
            eyebrow="Graph"
            title="Open a graph view"
            description="Jump into the global graph or open the graph scoped to the selected workspace."
            primary-label="Open Global Graph"
            :secondary-label="workbenchStore.selectedWorkspaceId ? 'Open Workspace Graph' : undefined"
            @primary="openGraphTab('global')"
            @secondary="openGraphTab('workspace')"
          />
        </div>
      </template>

      <template v-else-if="workbenchStore.activeActivity === 'search'">
        <div class="workbench__pane">
          <input v-model="sidebarQuery" class="workbench__search" placeholder="Search docs..." />
          <WorkbenchEmptyState
            v-if="!sidebarQuery.trim()"
            compact
            eyebrow="Search"
            title="Search your library"
            description="Type a document title, author, or tag to jump straight into the matching paper."
          />
          <WorkbenchEmptyState
            v-else-if="noteSearchResults.length === 0"
            compact
            eyebrow="Search"
            title="No search results"
            description="No document matched this query. Clear the search or try a different keyword."
            primary-label="Clear Search"
            @primary="sidebarQuery = ''"
          />
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
        <div class="workbench__pane workbench__pane--profile">
          <section class="profile-pane__card">
            <div class="profile-pane__card-header">
              <div class="profile-pane__identity">
                <div class="profile-pane__avatar">{{ profileInitial }}</div>
                <div class="profile-pane__identity-copy">
                  <strong>{{ profileIdentity.username }}</strong>
                  <span>{{ profileIdentity.email }}</span>
                  <small>{{ profileJoinedLabel }}</small>
                </div>
              </div>
              <button
                v-if="!profileEditMode"
                class="profile-pane__action"
                @click="startProfileEdit"
              >
                Edit
              </button>
            </div>

            <template v-if="profileEditMode">
              <div class="profile-pane__form">
                <label class="profile-pane__field">
                  <span>Name</span>
                  <input v-model="profileEditForm.username" class="profile-pane__input" type="text" maxlength="64" />
                </label>
                <label class="profile-pane__field">
                  <span>Bio</span>
                  <textarea v-model="profileEditForm.bio" class="profile-pane__input profile-pane__textarea" rows="3" maxlength="240"></textarea>
                </label>
                <label class="profile-pane__field">
                  <span>Default translation</span>
                  <select v-model="profileEditForm.defaultTranslationLang" class="profile-pane__input">
                    <option v-for="option in translationLangOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <p v-if="profileSaveError" class="profile-pane__error">{{ profileSaveError }}</p>
                <div class="profile-pane__actions">
                  <button class="workbench__pane-cta profile-pane__primary" :disabled="updateProfileMutation.isPending.value" @click="saveProfileFromSidebar()">
                    {{ updateProfileMutation.isPending.value ? 'Saving...' : 'Save' }}
                  </button>
                  <button class="profile-pane__action" :disabled="updateProfileMutation.isPending.value" @click="cancelProfileEdit">Cancel</button>
                </div>
              </div>
            </template>
            <p v-else-if="profileIdentity.bio" class="profile-pane__bio">{{ profileIdentity.bio }}</p>
          </section>

          <section v-if="profileQuickStats.length" class="profile-pane__section">
            <div class="profile-pane__section-title">Overview</div>
            <div class="profile-pane__stats">
              <div
                v-for="item in profileQuickStats"
                :key="item.label"
                class="profile-pane__stat"
              >
                <strong>{{ item.value }}</strong>
                <span>{{ item.label }}</span>
              </div>
            </div>
          </section>

          <section class="profile-pane__section">
            <div class="profile-pane__section-title">Preferences</div>
            <div class="profile-pane__rows">
              <div class="profile-pane__row">
                <span>Default translation</span>
                <strong>{{ profileLanguageLabel }}</strong>
              </div>
              <div class="profile-pane__row">
                <span>Custom models</span>
                <strong>{{ profileStore.llmKeys.length }}</strong>
              </div>
              <div class="profile-pane__row">
                <span>Workspace scope</span>
                <strong>{{ workbenchStore.selectedWorkspaceId ? 'Bound' : 'Global' }}</strong>
              </div>
            </div>
          </section>

          <button class="workbench__pane-cta profile-pane__logout" @click="authStore.handleLogout()">Sign Out</button>
        </div>
      </template>
    </aside>

    <div
      v-if="workbenchStore.layout.sidebarVisible"
      class="workbench__resizer"
      @mousedown="startLayoutResize($event, 'sidebar')"
    ></div>

    <main class="workbench__main">
      <EditorTabs
        :tabs="workbenchStore.openTabs"
        :active-tab-id="workbenchStore.activeTabId"
        @activate="workbenchStore.activateTab"
        @close="workbenchStore.closeTab"
        @close-others="workbenchStore.closeOtherTabs"
      />

      <div class="workbench__content" :style="contentStyle">
        <div class="workbench__editor">
          <div v-if="!activeTab" class="workbench__editor-empty">
            <WorkbenchEmptyState
              eyebrow="Workbench"
              title="No editor open"
              description="Open a document, note, or graph from the sidebar. This area now behaves like an empty editor group instead of forcing a welcome tab."
              primary-label="Upload Document"
              @primary="openUpload"
            />
          </div>

          <DocumentReaderTab
            v-else-if="activeDocumentTab"
            class="workbench__editor-panel"
            :document-id="activeDocumentTab.payload.documentId"
            @open-note="workbenchStore.openNoteTab"
          />

          <NoteEditorTab
            v-else-if="activeNoteTab"
            class="workbench__editor-panel"
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
            class="workbench__editor-panel"
            :workspace-id="activeGraphTab.payload.workspaceId"
          />
        </div>

        <div
          v-if="workbenchStore.layout.auxPanelVisible"
          class="workbench__resizer workbench__resizer--aux"
          @mousedown="startLayoutResize($event, 'aux')"
        ></div>

        <aside v-if="workbenchStore.layout.auxPanelVisible" class="workbench__chat">
          <div class="workbench__chat-header">
            <span>AI Chat</span>
            <button
              class="workbench__sidebar-icon"
              title="Hide Chat"
              @click="workbenchStore.hideAuxPanel()"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
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
        <span>{{ currentSidebarTitle }}</span>
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
  width: 100%;
  min-width: 0;
  height: 100vh;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  background: var(--c-bg-page);
  overflow: hidden;
}

.workbench__sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--c-bg-elevated);
}

.workbench__sidebar-header {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px;
  border-bottom: var(--border-width) solid var(--c-sidebar-border);
}

.workbench__sidebar-title {
  color: var(--c-sidebar-text);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.workbench__sidebar-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.workbench__sidebar-icon {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--c-sidebar-text-muted);
}

.workbench__sidebar-icon svg {
  width: 14px;
  height: 14px;
}

.workbench__sidebar-icon:hover {
  background: var(--c-sidebar-bg-hover);
  color: var(--c-sidebar-text);
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

.workbench__pane--profile {
  gap: 12px;
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

.profile-pane__card,
.profile-pane__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  background: var(--c-sidebar-bg-hover);
}

.profile-pane__card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.profile-pane__identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.profile-pane__avatar {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--c-accent-bg);
  color: var(--c-accent);
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
}

.profile-pane__identity-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.profile-pane__identity-copy strong,
.profile-pane__row strong,
.profile-pane__stat strong {
  color: var(--c-sidebar-text);
}

.profile-pane__identity-copy span,
.profile-pane__identity-copy small,
.profile-pane__bio,
.profile-pane__row span,
.profile-pane__stat span {
  color: var(--c-sidebar-text-subtle);
}

.profile-pane__identity-copy span,
.profile-pane__bio,
.profile-pane__row span {
  font-size: 12px;
  line-height: 1.5;
}

.profile-pane__identity-copy small,
.profile-pane__stat span {
  font-size: 11px;
}

.profile-pane__bio {
  margin: 0;
}

.profile-pane__section-title {
  color: var(--c-sidebar-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.profile-pane__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.profile-pane__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border-radius: 10px;
  background: var(--c-bg-elevated);
}

.profile-pane__rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.profile-pane__form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.profile-pane__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.profile-pane__field span {
  color: var(--c-sidebar-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.profile-pane__input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--c-bg-input);
  border: var(--border-width) solid var(--c-border-input);
  color: var(--c-text-primary);
}

.profile-pane__textarea {
  resize: vertical;
  min-height: 84px;
}

.profile-pane__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.profile-pane__action {
  min-height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--c-bg-elevated);
  color: var(--c-text-primary);
  border: var(--border-width) solid var(--c-border-input);
  font-size: 12px;
  font-weight: 600;
}

.profile-pane__primary {
  min-width: 84px;
}

.profile-pane__error {
  color: var(--c-error);
  font-size: 12px;
  line-height: 1.5;
}

.profile-pane__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.profile-pane__logout {
  width: 100%;
  justify-content: center;
}

.workbench__resizer {
  cursor: col-resize;
  background:
    linear-gradient(
      90deg,
      transparent calc(50% - 0.5px),
      var(--c-border-light) calc(50% - 0.5px),
      var(--c-border-light) calc(50% + 0.5px),
      transparent calc(50% + 0.5px)
    );
  transition: background var(--duration-fast) var(--ease-default);
}

.workbench__resizer--aux {
  min-width: 4px;
}

.workbench__resizer:hover {
  background:
    linear-gradient(
      90deg,
      transparent calc(50% - 0.5px),
      var(--c-accent-border) calc(50% - 0.5px),
      var(--c-accent-border) calc(50% + 0.5px),
      transparent calc(50% + 0.5px)
    );
}

.workbench__main {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-rows: 40px minmax(0, 1fr) 24px;
  overflow: hidden;
}

.workbench__content {
  width: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  overflow: hidden;
}

.workbench__editor {
  width: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--c-bg-primary);
  overflow: hidden;
}

.workbench__editor-empty,
.workbench__editor-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.workbench__editor-empty {
  display: grid;
  place-items: stretch;
  overflow: auto;
}

.workbench__chat {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--c-bg-elevated);
}

.workbench__chat-header {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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

</style>
