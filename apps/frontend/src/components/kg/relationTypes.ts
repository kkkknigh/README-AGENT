/**
 * 知识图谱关系类型定义
 *
 * 基于 CiTO、SKOS、ConceptNet、scite.ai 等学术标准调研筛选，
 * 9 种预制关系 + 1 个隐藏默认(related_to) + 自定义输入。
 */

export interface RelationTypeDef {
  value: string
  label: string
  color: string
  directed: boolean
  strokeDasharray?: string   // undefined = 实线
  strokeWidth: number
  markerEnd: 'arrow' | 'none'
  hideLabel: boolean          // 图上是否隐藏关系描述
  tier: 'pinned' | 'primary' | 'expanded' | 'hidden'
}

export const RELATION_TYPES: RelationTypeDef[] = [
  // ── pinned: parent_of 置顶，黑色实线+单向箭头，图上隐藏描述 ──
  { value: 'parent_of',    label: '父节点',   color: '#1a1a1a', directed: true,  strokeWidth: 2.5, markerEnd: 'arrow', hideLabel: true,  tier: 'pinned' },

  // ── primary: 常显 ──
  { value: 'extends',      label: '扩展',     color: '#22c55e', directed: true,  strokeWidth: 1.5, markerEnd: 'arrow', hideLabel: false, tier: 'primary' },
  { value: 'supports',     label: '支持',     color: '#06b6d4', directed: true,  strokeWidth: 1.5, markerEnd: 'arrow', hideLabel: false, tier: 'primary' },
  { value: 'contradicts',  label: '对立',     color: '#f43f5e', directed: false, strokeWidth: 1.5, markerEnd: 'none',  hideLabel: false, tier: 'primary', strokeDasharray: '8 4' },
  { value: 'uses_method',  label: '使用方法', color: '#0ea5e9', directed: true,  strokeWidth: 1.5, markerEnd: 'arrow', hideLabel: false, tier: 'primary', strokeDasharray: '2 4' },

  // ── expanded: 展开区 ──
  { value: 'derived_from', label: '衍生自',   color: '#8b5cf6', directed: true,  strokeWidth: 1.5, markerEnd: 'arrow', hideLabel: false, tier: 'expanded', strokeDasharray: '12 6' },
  { value: 'similar_to',   label: '相似',     color: '#a78bfa', directed: false, strokeWidth: 1.5, markerEnd: 'none',  hideLabel: false, tier: 'expanded', strokeDasharray: '2 4' },
  { value: 'causes',       label: '导致',     color: '#ef4444', directed: true,  strokeWidth: 1.5, markerEnd: 'arrow', hideLabel: false, tier: 'expanded' },
  { value: 'supersedes',   label: '取代',     color: '#78716c', directed: true,  strokeWidth: 1.5, markerEnd: 'arrow', hideLabel: false, tier: 'expanded', strokeDasharray: '8 4' },

  // ── hidden: 默认关系，黑色虚线，无箭头，图上隐藏描述 ──
  { value: 'related_to',   label: '相关',     color: '#1a1a1a', directed: false, strokeWidth: 1,   markerEnd: 'none',  hideLabel: true,  tier: 'hidden', strokeDasharray: '4 4' },
]

const typeMap = new Map(RELATION_TYPES.map(t => [t.value, t]))

const fallbackDef: RelationTypeDef = {
  value: '', label: '', color: '#94a3b8', directed: true,
  strokeWidth: 1.5, markerEnd: 'arrow', hideLabel: false, tier: 'hidden',
}

export function getRelationDef(type: string): RelationTypeDef {
  return typeMap.get(type) ?? { ...fallbackDef, value: type, label: type }
}

export function getRelationColor(type: string): string {
  return (typeMap.get(type) ?? fallbackDef).color
}

export function getRelationLabel(type: string): string {
  return typeMap.get(type)?.label ?? type
}
