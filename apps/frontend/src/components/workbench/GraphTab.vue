<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GraphEdgeRecord, GraphNodeRecord } from '../../api'
import { useDocumentsQuery } from '../../composables/queries/useLibraryQueries'
import {
  useCreateGraphEdgeMutation,
  useCreateGraphNodeMutation,
  useDeleteGraphEdgeMutation,
  useDeleteGraphNodeMutation,
  useGraphProjectDetailQuery,
  useTagProjectQuery,
  useUpdateGraphEdgeMutation,
  useUpdateGraphNodeMutation,
} from '../../composables/queries/useKgQueries'
import KgGraphView from '../kg/KgGraphView.vue'
import KgNodeDetail from '../kg/KgNodeDetail.vue'
import KgEdgeDetail from '../kg/KgEdgeDetail.vue'

const props = defineProps<{
  workspaceId?: string | null
}>()

const selectedNodeId = ref<string | null>(null)
const selectedEdgeId = ref<string | null>(null)
const createMode = ref(false)
const pendingNodePosition = ref<{ x: number; y: number } | null>(null)
const createLabel = ref('')

const tagProjectQuery = useTagProjectQuery()
const projectId = computed(() => tagProjectQuery.data.value?.id ?? null)
const detailQuery = useGraphProjectDetailQuery(projectId)
const { data: documents } = useDocumentsQuery()

const createNodeMutation = useCreateGraphNodeMutation(projectId)
const updateNodeMutation = useUpdateGraphNodeMutation(projectId)
const deleteNodeMutation = useDeleteGraphNodeMutation(projectId)
const createEdgeMutation = useCreateGraphEdgeMutation(projectId)
const updateEdgeMutation = useUpdateGraphEdgeMutation(projectId)
const deleteEdgeMutation = useDeleteGraphEdgeMutation(projectId)

const nodes = computed(() => detailQuery.data.value?.nodes ?? [])
const edges = computed(() => detailQuery.data.value?.edges ?? [])
const selectedNode = computed<GraphNodeRecord | null>(() => nodes.value.find((node) => node.id === selectedNodeId.value) ?? null)
const selectedEdge = computed<GraphEdgeRecord | null>(() => edges.value.find((edge) => edge.id === selectedEdgeId.value) ?? null)

function createNode() {
  if (!createLabel.value.trim()) return
  createNodeMutation.mutate({ label: createLabel.value.trim() })
  createLabel.value = ''
  createMode.value = false
}
</script>

<template>
  <div class="graph-tab">
    <aside class="graph-tab__side">
      <div class="graph-tab__side-header">
        <div>
          <div class="graph-tab__eyebrow">Graph</div>
          <div class="graph-tab__title">{{ props.workspaceId ? 'Workspace Graph Context' : 'Global Tag Graph' }}</div>
        </div>
        <button class="graph-tab__create-btn" @click="createMode = !createMode">
          {{ createMode ? 'Cancel' : 'New Node' }}
        </button>
      </div>

      <div v-if="createMode" class="graph-tab__create">
        <input v-model="createLabel" class="graph-tab__input" placeholder="Node label" @keyup.enter="createNode" />
        <button class="graph-tab__create-btn graph-tab__create-btn--primary" @click="createNode">Create</button>
      </div>

      <div class="graph-tab__detail">
        <KgNodeDetail
          v-if="selectedNode"
          :node="selectedNode"
          :all-nodes="nodes"
          :all-documents="documents || []"
          :is-saving="updateNodeMutation.isPending.value"
          :is-deleting="deleteNodeMutation.isPending.value"
          @save="updateNodeMutation.mutate({ nodeId: selectedNode.id, payload: $event })"
          @delete="deleteNodeMutation.mutate(selectedNode.id)"
          @link-paper="() => {}"
          @unlink-paper="() => {}"
          @link-note="() => {}"
          @unlink-note="() => {}"
          @open-paper="() => {}"
          @paper-contextmenu="() => {}"
        />
        <KgEdgeDetail
          v-else-if="selectedEdge"
          :edge="selectedEdge"
          :is-saving="updateEdgeMutation.isPending.value"
          :is-deleting="deleteEdgeMutation.isPending.value"
          @save="updateEdgeMutation.mutate({ edgeId: selectedEdge.id, payload: $event })"
          @delete="deleteEdgeMutation.mutate(selectedEdge.id)"
        />
        <div v-else class="graph-tab__empty">
          Select a node or edge.
        </div>
      </div>
    </aside>

    <div class="graph-tab__canvas">
      <KgGraphView
        :nodes="nodes"
        :edges="edges"
        :project-id="projectId"
        :selected-node-id="selectedNodeId"
        :selected-edge-id="selectedEdgeId"
        @node-select="(nodeId) => { selectedNodeId = nodeId; selectedEdgeId = null }"
        @edge-select="(edgeId) => { selectedEdgeId = edgeId; selectedNodeId = null }"
        @pane-click="() => { selectedNodeId = null; selectedEdgeId = null }"
        @connect="(source, target) => createEdgeMutation.mutate({ source_node_id: source, target_node_id: target })"
      />
    </div>
  </div>
</template>

<style scoped>
.graph-tab {
  height: 100%;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  background: var(--c-bg-primary);
}

.graph-tab__side {
  display: flex;
  flex-direction: column;
  border-right: var(--border-width) solid var(--c-border-light);
  background: var(--c-bg-elevated);
}

.graph-tab__side-header,
.graph-tab__create {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: var(--border-width) solid var(--c-border-light);
}

.graph-tab__eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--c-text-muted);
}

.graph-tab__title {
  color: var(--c-text-primary);
  font-size: 14px;
  font-weight: 600;
}

.graph-tab__create-btn {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--c-bg-hover);
  color: var(--c-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.graph-tab__create-btn--primary {
  background: var(--c-accent);
  color: white;
}

.graph-tab__input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--c-bg-input);
  border: var(--border-width) solid var(--c-border-input);
  color: var(--c-text-primary);
}

.graph-tab__detail {
  flex: 1;
  overflow: auto;
  padding: 14px;
}

.graph-tab__empty {
  color: var(--c-text-muted);
  font-size: 13px;
}

.graph-tab__canvas {
  min-width: 0;
  min-height: 0;
  background: var(--c-bg-page);
}
</style>
