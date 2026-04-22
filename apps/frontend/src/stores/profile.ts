import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CustomModel } from '../types'

export interface UserProfile {
  id: string
  username: string
  email: string
  avatarUrl: string | null
  bio: string | null
  preferences: Record<string, any>
  createdAt: string | null
}

export interface UserStats {
  paperCount: number
  noteCount: number
  highlightCount: number
  chatCount: number
  graphCount: number
}

const LLM_KEYS_STORAGE_KEY = 'readme_llm_keys'

function loadFromStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveToStorage<T>(key: string, data: T) {
  localStorage.setItem(key, JSON.stringify(data))
}

function loadLlmKeysFromStorage(): CustomModel[] {
  return loadFromStorage<CustomModel[]>(LLM_KEYS_STORAGE_KEY) || []
}

/**
 * Profile Store (瘦身版)
 * 主要职责：
 * 1. 管理用户本地存储的 LLM Keys (不需要后端同步)
 * 2. 提供一些基础的计算属性 (如本地默认语言)
 * 
 * 注意：UserProfile 和 UserStats 数据现在主要通过 useProfileQuery 和 useStatsQuery 在组件中直接使用，
 * 除非需要跨多个无关组件共享极小量的派生状态。
 */
export const useProfileStore = defineStore('profile', () => {
  // LLM Keys — 仅存 localStorage，不过后端
  const llmKeys = ref<CustomModel[]>(loadLlmKeysFromStorage())

  /**
   * 迁移提示：
   * 原本的 profile, stats, loading 等状态已作为 Query 移入 useProfileQueries.ts
   * 如果仍有组件需要从 store 读取，可以考虑在根组件订阅 Query 结果并回填 Store，
   * 但本架构倾向于“组件直接消费 Query”。
   */

  // LLM Key 管理 — 纯 localStorage
  function addLlmKey(info: { name: string; apiBase: string; apiKey: string }) {
    const model: CustomModel = { id: `custom_${Date.now()}`, ...info }
    llmKeys.value.push(model)
    saveToStorage(LLM_KEYS_STORAGE_KEY, llmKeys.value)
    return model
  }

  function removeLlmKey(index: number) {
    llmKeys.value.splice(index, 1)
    saveToStorage(LLM_KEYS_STORAGE_KEY, llmKeys.value)
  }

  function updateLlmKey(index: number, info: { name: string; apiBase: string; apiKey: string }) {
    const existing = llmKeys.value[index]
    if (!existing) return
    const updated: CustomModel = { ...info, id: existing.id }
    llmKeys.value[index] = updated
    saveToStorage(LLM_KEYS_STORAGE_KEY, llmKeys.value)
  }

  function $reset() {
    // LLM Keys 不清除，作为用户本地资产保留
  }

  return {
    llmKeys,
    addLlmKey,
    removeLlmKey,
    updateLlmKey,
    $reset,
  }
})
