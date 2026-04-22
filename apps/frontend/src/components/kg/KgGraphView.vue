<script setup lang="ts">
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { ConnectionMode, Handle, MarkerType, Panel, Position, VueFlow, useVueFlow } from '@vue-flow/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { GraphEdgeRecord, GraphNodeRecord } from '../../api'
import { useTagStore } from '../../stores/tag'
import { getRelationDef } from './relationTypes'
import { computeForceLayout, loadCachedPositions, saveCachedPositions, saveNodePosition, clearCachedPositions, loadCachedViewport, saveCachedViewport, type LayoutPosition } from './useGraphLayout'

const props = defineProps<{
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
  selectedNodeId: string | null
  selectedEdgeId: string | null
  projectId: string | null
  highlightedNodeIds?: Set<string>
  toolbarMode?: 'none' | 'add-node' | 'add-edge'
}>()

const emit = defineEmits<{
  'node-select': [nodeId: string]
  'edge-select': [edgeId: string]
  'edge-group-select': [sourceId: string, targetId: string]
  'pane-click': [event: MouseEvent]
  'node-contextmenu': [nodeId: string, event: MouseEvent]
  'edge-contextmenu': [edgeId: string, event: MouseEvent]
  'pane-contextmenu': [event: MouseEvent]
  'node-drag-merge': [sourceId: string, targetId: string]
  connect: [source: string, target: string]
  'edge-reconnect': [edgeId: string, newSource: string, newTarget: string]
  'toolbar-mode-change': [mode: 'none' | 'add-node' | 'add-edge']
}>()

// ==================== 边 handle 位置缓存 ====================
const edgeHandleMap = ref(new Map<string, { sourceHandle?: string; targetHandle?: string }>())

const tagStore = useTagStore()
const FLOW_ID = 'kg-graph-view'
const { fitView, findNode, getViewport, setViewport, project } = useVueFlow(FLOW_ID)

// ==================== Hover 高亮 ====================
const hoveredNodeId = ref<string | null>(null)

/** 邻接表：O(E) 构建一次，后续邻居查询 O(1) */
const adjacencyMap = computed(() => {
  const map = new Map<string, Set<string>>()
  for (const e of props.edges) {
    let s = map.get(e.source_node_id)
    if (!s) { s = new Set(); map.set(e.source_node_id, s) }
    s.add(e.target_node_id)
    let t = map.get(e.target_node_id)
    if (!t) { t = new Set(); map.set(e.target_node_id, t) }
    t.add(e.source_node_id)
  }
  return map
})

const neighborIds = computed(() => {
  if (!hoveredNodeId.value) return new Set<string>()
  const neighbors = adjacencyMap.value.get(hoveredNodeId.value)
  return neighbors ? new Set([hoveredNodeId.value, ...neighbors]) : new Set([hoveredNodeId.value])
})

const selectedNeighborIds = computed(() => {
  if (!props.selectedNodeId) return new Set<string>()
  const neighbors = adjacencyMap.value.get(props.selectedNodeId)
  return neighbors ? new Set([props.selectedNodeId, ...neighbors]) : new Set([props.selectedNodeId])
})

// ==================== Force 布局 ====================
const layoutPositions = ref<Map<string, LayoutPosition>>(new Map())

/** 全量力导向布局（仅初始化或 fitView 时使用） */
function recalcLayout() {
  const pid = props.projectId
  const cached = pid ? loadCachedPositions(pid) : new Map()
  layoutPositions.value = computeForceLayout(props.nodes, props.edges, cached)
  if (pid) saveCachedPositions(pid, layoutPositions.value)
}

/** 计算现有节点的质心 */
function getCentroid(): LayoutPosition {
  if (!layoutPositions.value.size) return { x: 500, y: 400 }
  let sx = 0, sy = 0
  for (const p of layoutPositions.value.values()) { sx += p.x; sy += p.y }
  return { x: sx / layoutPositions.value.size, y: sy / layoutPositions.value.size }
}

/** 持久化所有位置 */
function persistPositions() {
  const pid = props.projectId
  if (pid) saveCachedPositions(pid, layoutPositions.value)
}

// 上一次的节点 ID 集合，用于增量比对
let prevIdSet = new Set<string>()

watch(
  () => props.nodes.map(n => n.id).join(',') + '|' + props.edges.length,
  (_newKey, oldKey) => {
    const newIds = new Set(props.nodes.map(n => n.id))

    // 首次加载：全量布局
    if (!oldKey) {
      recalcLayout()
      prevIdSet = newIds
      return
    }

    const added = [...newIds].filter(id => !prevIdSet.has(id))
    const removed = [...prevIdSet].filter(id => !newIds.has(id))
    prevIdSet = newIds

    if (added.length === 0 && removed.length === 0) {
      // 仅 edge count 变了，全量重算
      recalcLayout()
      return
    }

    // —— temp→real ID 替换：位置就地转移，不重算 ——
    const tempRemoved = removed.filter(id => id.startsWith('temp-'))
    if (tempRemoved.length > 0 && tempRemoved.length >= added.length) {
      const positions = new Map(layoutPositions.value)
      for (let i = 0; i < added.length; i++) {
        const pos = positions.get(tempRemoved[i]!)
        if (pos) positions.set(added[i]!, pos)
        positions.delete(tempRemoved[i]!)
      }
      for (const id of tempRemoved.slice(added.length)) positions.delete(id)
      layoutPositions.value = positions
      persistPositions()
      return
    }

    // —— 纯新增节点：增量插入位置，不跑 force ——
    if (added.length > 0 && removed.length === 0) {
      // 大批量新增（如刷新后数据到达）：走全量布局以利用 localStorage 缓存
      if (added.length > 5 && layoutPositions.value.size === 0) {
        recalcLayout()
        return
      }
      const positions = new Map(layoutPositions.value)
      const center = getCentroid()
      const pending = nextNodePosition.value
      nextNodePosition.value = null
      // 加载 localStorage 缓存，用于补全未命中的节点
      const pid = props.projectId
      const cached = pid ? loadCachedPositions(pid) : new Map<string, { x: number; y: number }>()
      for (const id of added) {
        if (!positions.has(id)) {
          if (pending) {
            positions.set(id, pending)
          } else if (cached.has(id)) {
            positions.set(id, cached.get(id)!)
          } else {
            positions.set(id, {
              x: center.x + (Math.random() - 0.5) * 200,
              y: center.y + (Math.random() - 0.5) * 150,
            })
          }
        }
      }
      layoutPositions.value = positions
      persistPositions()
      return
    }

    // —— 纯删除节点：移除位置 ——
    if (removed.length > 0 && added.length === 0) {
      const positions = new Map(layoutPositions.value)
      for (const id of removed) positions.delete(id)
      layoutPositions.value = positions
      persistPositions()
      return
    }

    // —— 其他情况：全量重算 ——
    recalcLayout()
  },
  { immediate: true },
)

function handleFitView() {
  if (props.projectId) clearCachedPositions(props.projectId)
  recalcLayout()
  nextTick(() => fitView({ padding: 0.2 }))
}

// ==================== 工具栏辅助方法 ====================
const nextNodePosition = ref<LayoutPosition | null>(null)

function setNextNodePosition(pos: LayoutPosition) {
  nextNodePosition.value = pos
}

function screenToFlowPosition(clientX: number, clientY: number): { x: number; y: number } {
  const vfEl = document.getElementById(FLOW_ID)
  const rect = vfEl?.getBoundingClientRect() ?? { left: 0, top: 0 }
  return project({ x: clientX - rect.left, y: clientY - rect.top })
}

defineExpose({ fitView: handleFitView, recalcLayout, screenToFlowPosition, setNextNodePosition })

// ==================== 平行边合并 ====================
interface EdgeGroup {
  key: string // "source|target" 规范化 key
  sourceId: string
  targetId: string
  edges: GraphEdgeRecord[]
}

const edgeGroups = computed(() => {
  const map = new Map<string, EdgeGroup>()
  for (const e of props.edges) {
    // 规范化 key: 使用排序后的 id 对，确保 A→B 和 B→A 归为同一组
    const [lo, hi] = e.source_node_id < e.target_node_id
      ? [e.source_node_id, e.target_node_id]
      : [e.target_node_id, e.source_node_id]
    const key = `${lo}|${hi}`
    if (!map.has(key)) {
      map.set(key, { key, sourceId: lo, targetId: hi, edges: [] })
    }
    map.get(key)!.edges.push(e)
  }
  return map
})

// ==================== Flow 节点 ====================
// 使用 CSS class + CSS 变量替代内联 style，hover 时只切换 class，避免逐节点更新多个 style 属性
const flowNodes = computed(() => {
  const hl = props.highlightedNodeIds
  const hasHighlight = hl && hl.size > 0

  return props.nodes.map((node) => {
    const pos = layoutPositions.value.get(node.id) ?? { x: 0, y: 0 }
    const color = tagStore.getTagColor(node.label)
    const isSelected = node.id === props.selectedNodeId
    const isHovered = hoveredNodeId.value === node.id
    const isNeighbor = neighborIds.value.has(node.id)
    const isSelectedNeighbor = selectedNeighborIds.value.has(node.id)
    const isSearchMatch = hasHighlight ? hl!.has(node.id) : false
    const isDimmed = (hoveredNodeId.value !== null && !isNeighbor)
      || (hoveredNodeId.value === null && props.selectedNodeId !== null && !isSelectedNeighbor)
      || (hasHighlight && !isSearchMatch)

    return {
      id: node.id,
      type: 'kg',
      position: { x: pos.x, y: pos.y },
      data: { label: node.label, paperCount: node.linked_paper_ids?.length ?? 0 },
      // 颜色通过 CSS 变量传入，视觉状态通过 CSS class 控制
      style: { '--c': color },
      class: [
        isSelected && 'kg-selected',
        isHovered && 'kg-hovered',
        isDimmed && 'kg-dimmed',
        isSearchMatch && 'kg-search-match',
      ].filter(Boolean).join(' '),
    }
  })
})

// ==================== Flow 边（合并平行边） ====================
const flowEdges = computed(() => {
  const result: any[] = []

  for (const [, group] of edgeGroups.value) {
    const primary = group.edges[0]
    if (!primary) continue
    const def = getRelationDef(primary.relation_type)

    const isSelectedEdge = group.edges.some(e => e.id === props.selectedEdgeId)
    const isConnectedToSelected = props.selectedNodeId !== null &&
      (group.sourceId === props.selectedNodeId || group.targetId === props.selectedNodeId)
    const isHighlighted = isSelectedEdge || isConnectedToSelected
    const isRelated = hoveredNodeId.value !== null &&
      (group.sourceId === hoveredNodeId.value || group.targetId === hoveredNodeId.value)
    const isConnectedToSelectedNode = props.selectedNodeId !== null &&
      (group.sourceId === props.selectedNodeId || group.targetId === props.selectedNodeId)
    const isDimmed = (hoveredNodeId.value !== null && !isRelated)
      || (hoveredNodeId.value === null && props.selectedNodeId !== null && !isConnectedToSelectedNode)

    // 合并 label: 隐藏 hideLabel 的关系，只显示有标签的
    const visibleLabels = group.edges
      .map(e => { const d = getRelationDef(e.relation_type); return d.hideLabel ? '' : d.label || e.relation_type })
      .filter(Boolean)
    const label = visibleLabels.join(' · ') || undefined

    const color = def.color

    // marker: 只在 markerEnd === 'arrow' 时添加箭头，不添加 markerStart
    const markerEnd = def.markerEnd === 'arrow'
      ? { type: MarkerType.ArrowClosed, color }
      : undefined

    const flowEdgeId = group.edges.length === 1 ? primary.id : group.key
    const storedHandles = edgeHandleMap.value.get(flowEdgeId) ?? edgeHandleMap.value.get(group.key)

    result.push({
      id: flowEdgeId,
      source: primary.source_node_id,
      target: primary.target_node_id,
      sourceHandle: storedHandles?.sourceHandle ?? 's-bottom',
      targetHandle: storedHandles?.targetHandle ?? 't-top',
      reconnectable: isSelectedEdge,
      label,
      markerEnd,
      // opacity 交由 CSS class 控制，减少逐边内联 style 更新
      class: isDimmed ? 'kg-edge-dimmed' : '',
      style: {
        stroke: color,
        strokeWidth: (isHighlighted || isRelated) ? def.strokeWidth + 1 : def.strokeWidth,
        strokeDasharray: def.strokeDasharray,
      },
      labelStyle: label ? { fill: color, fontSize: '11px' } : undefined,
      data: { groupKey: group.key, edgeIds: group.edges.map(e => e.id) },
    })
  }

  return result
})

// ==================== 事件处理 ====================
function onConnect(params: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) {
  // 存储用户选择的 handle 位置
  const [lo, hi] = params.source < params.target ? [params.source, params.target] : [params.target, params.source]
  const groupKey = `${lo}|${hi}`
  edgeHandleMap.value.set(groupKey, {
    sourceHandle: params.sourceHandle ?? undefined,
    targetHandle: params.targetHandle ?? undefined,
  })
  emit('connect', params.source, params.target)
}

function onEdgeUpdate({ edge, connection }: { edge: any; connection: any }) {
  const edgeId = edge.id
  // 存储新的 handle 位置
  edgeHandleMap.value.set(edgeId, {
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
  })
  // 节点变了 → 通知父组件更新后端
  if (edge.source !== connection.source || edge.target !== connection.target) {
    const backendEdgeId = edge.data?.edgeIds?.[0] ?? edge.id
    emit('edge-reconnect', backendEdgeId, connection.source, connection.target)
  }
}

function onEdgeClick(edge: { id: string; data?: { groupKey?: string; edgeIds?: string[] } }) {
  if (edge.data?.edgeIds && edge.data.edgeIds.length > 1) {
    // 多边组：emit edge-group-select
    const group = edgeGroups.value.get(edge.data.groupKey!)
    if (group) emit('edge-group-select', group.sourceId, group.targetId)
  } else {
    // 单边：直接选中
    const edgeId = edge.data?.edgeIds?.[0] ?? edge.id
    emit('edge-select', edgeId)
  }
}

function onNodeContextMenu({ node, event }: { node: { id: string }; event: MouseEvent | TouchEvent }) {
  event.preventDefault()
  emit('node-contextmenu', node.id, event as MouseEvent)
}

function onEdgeContextMenu({ edge, event }: { edge: { id: string; data?: { edgeIds?: string[] } }; event: MouseEvent | TouchEvent }) {
  event.preventDefault()
  emit('edge-contextmenu', edge.data?.edgeIds?.[0] ?? edge.id, event as MouseEvent)
}

function onNodeDragStop(event: { node: { id: string; position: { x: number; y: number } } }) {
  const { id, position } = event.node
  const pid = props.projectId
  if (pid) saveNodePosition(pid, id, position)
  layoutPositions.value.set(id, position)

  const vfDragged = findNode(id)
  if (!vfDragged) return
  const dw = vfDragged.dimensions?.width ?? 150
  const dh = vfDragged.dimensions?.height ?? 40

  for (const other of props.nodes) {
    if (other.id === id) continue
    const vfOther = findNode(other.id)
    if (!vfOther) continue
    const ow = vfOther.dimensions?.width ?? 150
    const oh = vfOther.dimensions?.height ?? 40
    const ox = vfOther.position.x
    const oy = vfOther.position.y

    if (
      position.x < ox + ow &&
      position.x + dw > ox &&
      position.y < oy + oh &&
      position.y + dh > oy
    ) {
      emit('node-drag-merge', id, other.id)
      return
    }
  }
}

// ==================== Viewport 持久化（防抖） ====================
let moveEndTimer: ReturnType<typeof setTimeout> | null = null

function onMoveEnd() {
  const pid = props.projectId
  if (!pid) return
  if (moveEndTimer) clearTimeout(moveEndTimer)
  moveEndTimer = setTimeout(() => {
    const vp = getViewport()
    saveCachedViewport(pid, { x: vp.x, y: vp.y, zoom: vp.zoom })
  }, 250)
}

onUnmounted(() => { if (moveEndTimer) clearTimeout(moveEndTimer) })

// 恢复缓存的 viewport
const hasCachedViewport = ref(false)

onMounted(() => {
  const pid = props.projectId
  if (!pid) return
  const cached = loadCachedViewport(pid)
  if (cached) {
    hasCachedViewport.value = true
    nextTick(() => setViewport(cached, { duration: 0 }))
  }
})
</script>

<template>
  <div class="h-full w-full">
    <VueFlow
      v-if="flowNodes.length"
      :id="FLOW_ID"
      :class="['kg-graph-flow h-full w-full', { 'kg-add-edge-mode': toolbarMode === 'add-edge', 'kg-add-node-mode': toolbarMode === 'add-node' }]"
      :nodes="flowNodes"
      :edges="flowEdges"
      :min-zoom="0.2"
      :max-zoom="2"
      :connection-mode="ConnectionMode.Loose"
      :fit-view-on-init="!hasCachedViewport"
      @node-click="({ node }) => emit('node-select', node.id)"
      @edge-click="({ edge }) => onEdgeClick(edge)"
      @pane-click="(event: MouseEvent) => emit('pane-click', event)"
      @node-context-menu="onNodeContextMenu"
      @edge-context-menu="onEdgeContextMenu"
      @pane-context-menu="(event: MouseEvent) => { event.preventDefault(); emit('pane-contextmenu', event) }"
      @node-mouse-enter="({ node }) => hoveredNodeId = node.id"
      @node-mouse-leave="hoveredNodeId = null"
      @node-drag-stop="onNodeDragStop"
      @connect="onConnect"
      @edge-update="onEdgeUpdate"
      @move-end="onMoveEnd"
    >
      <template #node-kg="{ data }">
        <Handle id="s-top" type="source" :position="Position.Top" />
        <Handle id="s-right" type="source" :position="Position.Right" />
        <Handle id="s-bottom" type="source" :position="Position.Bottom" />
        <Handle id="s-left" type="source" :position="Position.Left" />
        <span>{{ data.label }}</span>
      </template>
      <Background pattern-color="var(--c-border-divider, #e5e7eb)" :gap="16" :size="1" />
      <Controls position="bottom-left" />
      <Panel position="top-left" class="kg-toolbar">
        <button
          class="kg-toolbar-btn"
          :class="{ 'kg-toolbar-btn--active': toolbarMode === 'add-node' }"
          title="添加节点 (点击画布创建)"
          @click.stop="emit('toolbar-mode-change', toolbarMode === 'add-node' ? 'none' : 'add-node')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8" stroke-width="2" />
            <path stroke-linecap="round" stroke-width="2" d="M12 9v6m-3-3h6" />
          </svg>
          <span>节点</span>
        </button>
        <button
          class="kg-toolbar-btn"
          :class="{ 'kg-toolbar-btn--active': toolbarMode === 'add-edge' }"
          title="添加关系 (从节点拖向节点)"
          @click.stop="emit('toolbar-mode-change', toolbarMode === 'add-edge' ? 'none' : 'add-edge')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span>关系</span>
        </button>
      </Panel>
    </VueFlow>
    <div v-else class="h-full flex items-center justify-center p-6 text-sm text-gray-400">
      右键空白处可以创建节点
    </div>
  </div>
</template>

<style scoped>
/* ---- 节点基础样式 ---- */
:deep(.vue-flow__node) {
  min-width: 120px;
  max-width: 220px;
  border-radius: 14px;
  padding: 10px 12px;
  text-align: center;
  border-style: solid;
  cursor: grab;
  /* 默认状态：使用 CSS 变量 --c（由 JS 注入） */
  border-color: color-mix(in srgb, var(--c) 40%, transparent);
  background: color-mix(in srgb, var(--c) 7%, transparent);
  border-width: 1px;
  font-weight: 400;
  opacity: 1;
  transition: opacity 0.2s, box-shadow 0.2s, border-width 0.15s;
}
:deep(.vue-flow__node.kg-selected) {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 13%, transparent);
  border-width: 2px;
  font-weight: 700;
}
:deep(.vue-flow__node.kg-hovered) {
  border-width: 2px;
  box-shadow: 0 0 20px color-mix(in srgb, var(--c) 25%, transparent);
}
:deep(.vue-flow__node.kg-dimmed) {
  opacity: 0.3;
  border-color: color-mix(in srgb, var(--c) 19%, transparent);
  background: color-mix(in srgb, var(--c) 2%, transparent);
}
:deep(.vue-flow__node.kg-search-match) {
  box-shadow: 0 0 16px color-mix(in srgb, var(--c) 38%, transparent);
}
:deep(.vue-flow__node.dragging) {
  cursor: grabbing;
}
/* ---- 边样式 ---- */
:deep(.vue-flow__edge-textbg) {
  fill: var(--c-bg-primary, #fff);
}
:deep(.vue-flow__edge) {
  transition: opacity 0.2s;
}
:deep(.vue-flow__edge.kg-edge-dimmed) {
  opacity: 0.15;
}

/* ---- Connection handles ---- */
:deep(.vue-flow__handle) {
  /* 实际点击区域 24x24，透明底 */
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.15s;
}
/* 可见圆点用 ::after 渲染 */
:deep(.vue-flow__handle::after) {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 8px;
  transform: translate(-50%, -50%);
  background: var(--c-graph-node);
  border: 2px solid var(--c-bg-primary, #fff);
  border-radius: 50%;
  transition: transform 0.15s;
}
:deep(.vue-flow__node:hover .vue-flow__handle) {
  opacity: 1;
}
:deep(.vue-flow__handle:hover::after) {
  transform: translate(-50%, -50%) scale(1.5);
  background: var(--c-graph-node-hover);
}
:deep(.vue-flow__handle.valid) {
  opacity: 1;
}
:deep(.vue-flow__handle.valid::after) {
  background: var(--c-graph-node-valid);
}
:deep(.vue-flow__handle.connecting) {
  opacity: 1;
}

/* Connection line while dragging */
:deep(.vue-flow__connection-line path) {
  stroke: var(--c-graph-node);
  stroke-width: 2;
  stroke-dasharray: 5 5;
}

/* ---- Toolbar ---- */
.kg-toolbar {
  display: flex;
  gap: 6px;
  padding: 0 !important;
}
.kg-toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--c-border-light, #e5e7eb);
  background: var(--c-bg-primary, #fff);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  color: var(--c-text-secondary, #6b7280);
  box-shadow: var(--shadow-sm);
}
.kg-toolbar-btn:hover {
  border-color: var(--c-graph-node);
  color: var(--c-graph-node);
}
.kg-toolbar-btn--active {
  background: var(--c-graph-node);
  color: var(--c-graph-node-text);
  border-color: var(--c-graph-node);
  box-shadow: 0 0 12px color-mix(in srgb, var(--c-graph-node) 30%, transparent);
}

/* ---- Mode-specific styles ---- */
/* 加边模式：handle 常显 */
:deep(.kg-add-edge-mode .vue-flow__handle) {
  opacity: 1;
}
/* 加节点模式：crosshair 光标 */
:deep(.kg-add-node-mode .vue-flow__pane) {
  cursor: crosshair;
}
</style>
