import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'
import type { GraphEdgeRecord, GraphNodeRecord } from '../../api'

export interface LayoutPosition { x: number; y: number }

const STORAGE_PREFIX = 'kg-positions-'
const VIEWPORT_PREFIX = 'kg-viewport-'

// ==================== localStorage 缓存 ====================

export function loadCachedPositions(projectId: string): Map<string, LayoutPosition> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + projectId)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, LayoutPosition>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

export function saveCachedPositions(projectId: string, positions: Map<string, LayoutPosition>) {
  const obj: Record<string, LayoutPosition> = {}
  positions.forEach((pos, id) => { obj[id] = pos })
  localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(obj))
}

export function saveNodePosition(projectId: string, nodeId: string, pos: LayoutPosition) {
  const cached = loadCachedPositions(projectId)
  cached.set(nodeId, pos)
  saveCachedPositions(projectId, cached)
}

export function clearCachedPositions(projectId: string) {
  localStorage.removeItem(STORAGE_PREFIX + projectId)
}

// ==================== Viewport 缓存 ====================

export interface CachedViewport { x: number; y: number; zoom: number }

export function loadCachedViewport(projectId: string): CachedViewport | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_PREFIX + projectId)
    if (!raw) return null
    return JSON.parse(raw) as CachedViewport
  } catch {
    return null
  }
}

export function saveCachedViewport(projectId: string, viewport: CachedViewport) {
  localStorage.setItem(VIEWPORT_PREFIX + projectId, JSON.stringify(viewport))
}

// ==================== 层级深度计算 ====================

/** 根据 parent_id 计算每个节点在树中的深度（根节点 depth=0） */
function computeDepthMap(nodes: GraphNodeRecord[]): Map<string, number> {
  const depthMap = new Map<string, number>()
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const childrenMap = new Map<string, string[]>()

  for (const n of nodes) {
    if (n.parent_id && nodeById.has(n.parent_id)) {
      const siblings = childrenMap.get(n.parent_id) ?? []
      siblings.push(n.id)
      childrenMap.set(n.parent_id, siblings)
    }
  }

  // BFS 从根节点开始
  const roots = nodes.filter(n => !n.parent_id || !nodeById.has(n.parent_id))
  const queue: { id: string; depth: number }[] = roots.map(n => ({ id: n.id, depth: 0 }))

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    if (depthMap.has(id)) continue
    depthMap.set(id, depth)
    for (const childId of childrenMap.get(id) ?? []) {
      if (!depthMap.has(childId)) queue.push({ id: childId, depth: depth + 1 })
    }
  }

  // 没有被遍历到的孤立节点视为 depth 0
  for (const n of nodes) {
    if (!depthMap.has(n.id)) depthMap.set(n.id, 0)
  }

  return depthMap
}

// ==================== 确定性树布局 ====================

const LAYER_GAP_Y = 180 // 层级间垂直间距
const NODE_H_GAP = 170  // 同层节点水平间距

/**
 * 确定性树布局：Reingold-Tilford 风格
 * 根节点在上方，子节点按层向下排列，同层兄弟水平展开
 */
function computeTreePositions(
  nodes: GraphNodeRecord[],
  centerX: number,
  centerY: number,
): Map<string, LayoutPosition> {
  if (!nodes.length) return new Map()

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const childrenMap = new Map<string, string[]>()

  for (const n of nodes) {
    if (n.parent_id && nodeById.has(n.parent_id)) {
      const siblings = childrenMap.get(n.parent_id) ?? []
      siblings.push(n.id)
      childrenMap.set(n.parent_id, siblings)
    }
  }

  // 根节点 = 没有 parent_id 或 parent 不在本图中
  const roots = nodes.filter(n => !n.parent_id || !nodeById.has(n.parent_id))

  // 计算每个子树占据的叶子宽度
  const widthCache = new Map<string, number>()
  function subtreeWidth(id: string): number {
    if (widthCache.has(id)) return widthCache.get(id)!
    const children = childrenMap.get(id) ?? []
    const w = children.length === 0 ? 1 : children.reduce((sum, c) => sum + subtreeWidth(c), 0)
    widthCache.set(id, w)
    return w
  }
  for (const r of roots) subtreeWidth(r.id)
  // 孤立节点
  for (const n of nodes) {
    if (!widthCache.has(n.id)) widthCache.set(n.id, 1)
  }

  const positions = new Map<string, LayoutPosition>()

  function layoutSubtree(id: string, left: number, y: number) {
    const children = childrenMap.get(id) ?? []
    const myWidth = (widthCache.get(id) ?? 1) * NODE_H_GAP

    if (children.length === 0) {
      // 叶节点：居中在分配的宽度内
      positions.set(id, { x: left + myWidth / 2, y })
      return
    }

    // 先布局子节点
    let childLeft = left
    for (const childId of children) {
      const childWidth = (widthCache.get(childId) ?? 1) * NODE_H_GAP
      layoutSubtree(childId, childLeft, y + LAYER_GAP_Y)
      childLeft += childWidth
    }

    // 父节点居中于子节点上方
    const firstChild = positions.get(children[0]!)!
    const lastChild = positions.get(children[children.length - 1]!)!
    positions.set(id, { x: (firstChild.x + lastChild.x) / 2, y })
  }

  // 所有根树并排布局
  const totalWidth = roots.reduce((sum, r) => sum + (widthCache.get(r.id) ?? 1), 0) * NODE_H_GAP
  let startX = centerX - totalWidth / 2

  for (const root of roots) {
    const rootWidth = (widthCache.get(root.id) ?? 1) * NODE_H_GAP
    layoutSubtree(root.id, startX, centerY)
    startX += rootWidth
  }

  return positions
}

// ==================== 力导向布局计算 ====================

interface SimNode {
  id: string
  depth: number
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

interface SimLink {
  source: string | SimNode
  target: string | SimNode
}

export function computeForceLayout(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  cachedPositions: Map<string, LayoutPosition>,
  centerX = 500,
  centerY = 400,
): Map<string, LayoutPosition> {
  if (!nodes.length) return new Map()

  // Derive center from existing cached positions so new nodes appear near the graph
  if (cachedPositions.size > 0) {
    let sx = 0, sy = 0
    for (const p of cachedPositions.values()) { sx += p.x; sy += p.y }
    centerX = sx / cachedPositions.size
    centerY = sy / cachedPositions.size
  }

  // 计算层级深度
  const depthMap = computeDepthMap(nodes)
  const maxDepth = Math.max(...Array.from(depthMap.values()), 0)
  const hasHierarchy = maxDepth > 0

  // 无缓存节点数量——决定是否需要初始布局
  const uncachedCount = nodes.filter(n => !cachedPositions.has(n.id)).length
  const needsInitialLayout = uncachedCount > nodes.length * 0.5

  // ---- 有层级且大部分节点无缓存：使用确定性树布局 ----
  if (hasHierarchy && needsInitialLayout) {
    const treePositions = computeTreePositions(nodes, centerX, centerY)
    // 已缓存的节点保留缓存位置
    for (const [id, pos] of cachedPositions) {
      if (treePositions.has(id)) treePositions.set(id, pos)
    }
    return treePositions
  }

  // ---- 所有节点都有缓存：直接返回缓存位置（补全缺失的） ----
  if (uncachedCount === 0) {
    const result = new Map<string, LayoutPosition>()
    for (const n of nodes) {
      result.set(n.id, cachedPositions.get(n.id) ?? { x: centerX, y: centerY })
    }
    return result
  }

  // ---- 无层级或少量新增：力导向布局 ----
  const hasExisting = cachedPositions.size > 0

  const simNodes: SimNode[] = nodes.map((n) => {
    const cached = cachedPositions.get(n.id)
    const depth = depthMap.get(n.id) ?? 0
    if (cached) {
      return { id: n.id, depth, x: cached.x, y: cached.y, fx: cached.x, fy: cached.y }
    }
    return {
      id: n.id,
      depth,
      x: centerX + (Math.random() - 0.5) * (hasExisting ? 200 : 600),
      y: centerY + (Math.random() - 0.5) * (hasExisting ? 150 : 400),
    }
  })

  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const simLinks: SimLink[] = edges
    .filter((e) => nodeIdSet.has(e.source_node_id) && nodeIdSet.has(e.target_node_id))
    .map((e) => ({ source: e.source_node_id, target: e.target_node_id }))

  // 根据节点数自适应 tick 次数：小图精算，大图快收敛
  const tickCount = nodes.length <= 50 ? 300
    : nodes.length <= 200 ? 200
    : nodes.length <= 500 ? 120
    : 80
  const alphaDecay = 1 - Math.pow(0.001, 1 / tickCount)

  const simulation = (forceSimulation as any)(simNodes)
    .force('charge', (forceManyBody as any)().strength(-300))
    .force('link', (forceLink as any)(simLinks).id((d: SimNode) => d.id).distance(150))
    .force('center', (forceCenter as any)(centerX, centerY))
    .force('collide', (forceCollide as any)(60))
    .alphaDecay(alphaDecay)

  simulation.stop()

  for (let i = 0; i < tickCount; i++) simulation.tick()

  const result = new Map<string, LayoutPosition>()
  for (const n of simNodes) {
    result.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 })
  }
  return result
}
