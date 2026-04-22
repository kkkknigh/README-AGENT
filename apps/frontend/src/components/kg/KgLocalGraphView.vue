<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { kgApi } from '../../api'
import KgGraphView from './KgGraphView.vue'

const props = defineProps<{
  nodeId: string
  nodeLabel: string
}>()

const emit = defineEmits<{
  close: []
  'navigate-node': [nodeId: string]
}>()

const hops = ref(2)
const selectedNodeId = ref<string | null>(null)

const localGraphQuery = useQuery({
  queryKey: computed(() => ['kg', 'local-graph', props.nodeId, hops.value]),
  queryFn: () => kgApi.getLocalGraph(props.nodeId, hops.value),
  enabled: computed(() => !!props.nodeId),
})

const nodes = computed(() => localGraphQuery.data.value?.nodes ?? [])
const edges = computed(() => localGraphQuery.data.value?.edges ?? [])
const centerNodeId = computed(() => localGraphQuery.data.value?.center_node_id ?? props.nodeId)

watch(() => props.nodeId, () => { selectedNodeId.value = null })

function onNodeSelect(nodeId: string) {
  if (nodeId === centerNodeId.value) {
    selectedNodeId.value = nodeId
  } else {
    emit('navigate-node', nodeId)
    emit('close')
  }
}
</script>

<template>
  <div class="absolute inset-0 z-20 flex items-center justify-center bg-black/30" @click.self="emit('close')">
    <div class="w-[720px] h-[520px] max-w-[90vw] max-h-[80vh] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
        <div>
          <p class="text-sm font-bold text-gray-900 dark:text-white">局部图谱 — {{ nodeLabel }}</p>
          <p class="text-xs text-gray-500">{{ nodes.length }} 个节点 · {{ edges.length }} 条关系</p>
        </div>
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-1.5 text-xs text-gray-500">
            跳数
            <input
              v-model.number="hops"
              type="range" min="1" max="3" step="1"
              class="w-16 h-1 accent-primary-600"
            />
            <span class="font-semibold text-gray-700 dark:text-gray-300 w-4 text-center">{{ hops }}</span>
          </label>
          <button class="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" @click="emit('close')">
            <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <!-- Graph -->
      <div class="flex-1 min-h-0 relative">
        <div v-if="localGraphQuery.isLoading.value" class="absolute inset-0 flex items-center justify-center">
          <p class="text-sm text-gray-400">加载中…</p>
        </div>
        <KgGraphView
          v-else-if="nodes.length"
          :nodes="nodes"
          :edges="edges"
          :selected-node-id="centerNodeId"
          :selected-edge-id="null"
          :project-id="null"
          :highlighted-node-ids="new Set([centerNodeId])"
          @node-select="onNodeSelect"
          @pane-click="() => {}"
        />
        <div v-else class="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
          无邻居节点
        </div>
      </div>
    </div>
  </div>
</template>
