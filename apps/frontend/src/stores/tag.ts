import { defineStore } from 'pinia'
import { ref } from 'vue'

const TAG_COLORS_KEY = 'readme_tag_colors'
const PRESET_COLORS = [
  '#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
  '#e11d48', '#84cc16', '#a855f7', '#0ea5e9', '#d946ef',
]

function loadTagColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TAG_COLORS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export const useTagStore = defineStore('tag', () => {
  const tagColors = ref<Record<string, string>>(loadTagColors())

  function getTagColor(tag: string): string {
    if (tagColors.value[tag]) return tagColors.value[tag]
    let hash = 0
    for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash)
    return PRESET_COLORS[Math.abs(hash) % PRESET_COLORS.length] as string
  }

  function setTagColor(tag: string, color: string) {
    tagColors.value = { ...tagColors.value, [tag]: color }
    localStorage.setItem(TAG_COLORS_KEY, JSON.stringify(tagColors.value))
  }

  function clearAll() {
    tagColors.value = {}
    localStorage.removeItem(TAG_COLORS_KEY)
  }

  return {
    tagColors,
    getTagColor,
    setTagColor,
    clearAll,
  }
})
