<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useProfileStore } from '../stores/profile'
import { profileApi } from '../api'
import {
  useProfileQuery,
  useStatsQuery,
  useUpdateProfileMutation,
  useChangePasswordMutation,
  useDeleteAccountMutation
} from '../composables/queries/useProfileQueries'
import { validatePassword } from '../utils/password'

const router = useRouter()
const authStore = useAuthStore()
const profileStore = useProfileStore()

// ==================== Vue Query ====================
const { data: profile } = useProfileQuery()
const { data: stats } = useStatsQuery()
const updateProfileMutation = useUpdateProfileMutation()
const changePasswordMutation = useChangePasswordMutation()
const deleteAccountMutation = useDeleteAccountMutation()

// 默认语言：优先从 profile.preferences 中读取，这通常由服务器同步
const selectedLang = computed(() => profile.value?.preferences?.defaultTranslationLang || 'zh')

// ==================== 状态 ====================
const activeTab = ref<'info' | 'security' | 'ai' | 'appearance' | 'data' | 'oauth'>('info')

// 个性设置 - 保存到本地存储
const autoHideCollapsedSidebar = useStorage('readme_auto_hide_collapsed_sidebar', false)

// 个人信息编辑
const editMode = ref(false)
const editForm = ref({ username: '', bio: '' })
const profileError = ref('')

// 密码修改
const passwordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })
const passwordError = ref('')
const passwordSuccess = ref(false)

// 密码可见性切换
const showOldPassword = ref(false)
const showNewPassword = ref(false)
const showDeletePassword = ref(false)

// LLM Key 编辑
const showAddKey = ref(false)
const newKeyForm = ref({ name: '', apiBase: '', apiKey: '' })
const editingKeyIndex = ref<number | null>(null)
const keyFormError = ref('')

// 默认翻译语言选项
const translationLangOptions = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
]

// 删除账号
const showDeleteConfirm = ref(false)
const deletePassword = ref('')
const deleteError = ref('')
const exportHint = ref('')

// API Key 管理
const apiKeys = ref<Array<{
  id: string
  name: string
  prefix: string
  isActive: boolean
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}>>([])
const expiredApiKeys = ref<Array<{
  id: string
  name: string
  prefix: string
  isActive: boolean
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}>>([])
const apiKeyLoading = ref(false)
const apiKeyError = ref('')
const showCreateApiKey = ref(false)
const newApiKeyForm = ref({ name: '', expiresInDays: '' })
const newlyCreatedApiKey = ref('')
const apiKeyMaxAllowed = ref(10)



// ==================== 计算属性 ====================
// 已迁移至 Vue Query 直接解构得到 profile 和 stats

// ==================== 生命周期 ====================
// Vue Query 自动处理数据获取，无需在 onMounted 手动调用 fetch

// ==================== 方法 ====================
function startEdit() {
  profileError.value = ''
  editForm.value = {
    username: profile.value?.username || '',
    bio: profile.value?.bio || '',
  }
  editMode.value = true
}

async function saveProfile() {
  try {
    await updateProfileMutation.mutateAsync({
      username: editForm.value.username,
      bio: editForm.value.bio,
    })
    profileError.value = ''
    editMode.value = false
  } catch (err: any) {
    profileError.value = err.response?.data?.error || '保存失败'
  }
}

async function changePassword() {
  passwordError.value = ''
  passwordSuccess.value = false

  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    passwordError.value = '两次输入的新密码不一致'
    return
  }
  const pwdCheck = validatePassword(passwordForm.value.newPassword)
  if (!pwdCheck.valid) {
    passwordError.value = '密码强度不足：需' + pwdCheck.errors.join('、')
    return
  }

  try {
    await changePasswordMutation.mutateAsync({ 
      oldPassword: passwordForm.value.oldPassword, 
      newPassword: passwordForm.value.newPassword 
    })
    passwordSuccess.value = true
    passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
  } catch (err: any) {
    passwordError.value = err.response?.data?.error || '修改失败'
  }
}

async function changeLang(lang: string) {
  const mergedPrefs = { ...(profile.value?.preferences || {}), defaultTranslationLang: lang }
  await updateProfileMutation.mutateAsync({ preferences: mergedPrefs })
}

function startAddKey() {
  keyFormError.value = ''
  newKeyForm.value = { name: '', apiBase: '', apiKey: '' }
  editingKeyIndex.value = null
  showAddKey.value = true
}

function startEditKey(index: number) {
  keyFormError.value = ''
  const key = profileStore.llmKeys[index]
  if (!key) return
  newKeyForm.value = { name: key.name, apiBase: key.apiBase, apiKey: key.apiKey }
  editingKeyIndex.value = index
  showAddKey.value = true
}

function saveKey() {
  if (!newKeyForm.value.name || !newKeyForm.value.apiBase) {
    keyFormError.value = '请填写模型名称和 API Base'
    return
  }
  keyFormError.value = ''
  if (editingKeyIndex.value !== null) {
    profileStore.updateLlmKey(editingKeyIndex.value, { ...newKeyForm.value })
  } else {
    profileStore.addLlmKey({ ...newKeyForm.value })
  }
  showAddKey.value = false
}

function removeKey(index: number) {
  if (!confirm('确定删除此 API Key 配置？')) return
  profileStore.removeLlmKey(index)
}

function handleExport() {
  exportHint.value = '导出功能开发中，敬请期待'
}

async function handleDeleteAccount() {
  deleteError.value = ''
  if (!deletePassword.value) {
    deleteError.value = '请输入密码'
    return
  }
  try {
    await deleteAccountMutation.mutateAsync(deletePassword.value)
    authStore.handleLogout()
  } catch (err: any) {
    deleteError.value = err.response?.data?.error || '删除失败'
  }
}

function goBack() {
  if (window.history.state?.back) {
    router.back()
  } else {
    router.push('/')
  }
}

function maskKey(key: string) {
  if (!key || key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '永不过期'
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN')
}

// ==================== API Key 管理方法 ====================
async function fetchApiKeys() {
  apiKeyLoading.value = true
  apiKeyError.value = ''
  try {
    const data = await profileApi.getApiKeys()
    // 防御性处理：确保数据格式正确
    apiKeys.value = data.apiKeys || []
    expiredApiKeys.value = data.expiredKeys || []
    apiKeyMaxAllowed.value = data.maxAllowed || 10
  } catch (err: any) {
    apiKeyError.value = err.response?.data?.error || '获取 API Key 列表失败'
    console.error('Failed to fetch API keys:', err)
  } finally {
    apiKeyLoading.value = false
  }
}

async function createApiKey() {
  apiKeyError.value = ''
  
  const expiresInDays = newApiKeyForm.value.expiresInDays 
    ? parseInt(newApiKeyForm.value.expiresInDays) 
    : null
  
  apiKeyLoading.value = true
  try {
    const data = await profileApi.createApiKey(
      newApiKeyForm.value.name || undefined,
      expiresInDays
    )
    newlyCreatedApiKey.value = data.apiKey
    showCreateApiKey.value = false
    newApiKeyForm.value = { name: '', expiresInDays: '' }
    // 刷新列表
    await fetchApiKeys()
  } catch (err: any) {
    const code = err.response?.data?.code
    if (code === 'LIMIT_EXCEEDED') {
      apiKeyError.value = `已达到最大数量限制 (${apiKeyMaxAllowed.value} 个)，请先删除一些 API Key`
    } else {
      apiKeyError.value = err.response?.data?.error || '创建失败'
    }
  } finally {
    apiKeyLoading.value = false
  }
}

async function deleteApiKey(keyId: string) {
  if (!confirm('确定要删除此 API Key 吗？删除后将无法恢复。')) return
  
  apiKeyLoading.value = true
  apiKeyError.value = ''
  try {
    await profileApi.deleteApiKey(keyId)
    await fetchApiKeys()
  } catch (err: any) {
    apiKeyError.value = err.response?.data?.error || '删除失败'
  } finally {
    apiKeyLoading.value = false
  }
}

function copyApiKey(key: string) {
  navigator.clipboard.writeText(key).then(() => {
    alert('API Key 已复制到剪贴板')
  }).catch(() => {
    alert('复制失败，请手动复制')
  })
}

function closeNewApiKeyDisplay() {
  newlyCreatedApiKey.value = ''
}

// 监听标签页切换，切换到 oauth 时获取 API Keys
watch(activeTab, (newTab) => {
  if (newTab === 'oauth') {
    fetchApiKeys()
  }
})
</script>

<template>
  <div class="h-screen overflow-y-auto bg-gray-50 dark:bg-[#1a1a1a]">
    <!-- 顶部导航 -->
    <header class="bg-white dark:bg-[#252526] border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
        </button>
        <h1 class="text-lg font-semibold text-gray-800 dark:text-gray-100">个人中心</h1>
      </div>
    </header>

    <div class="max-w-3xl mx-auto py-8 px-4">
      <!-- 用户卡片 -->
      <div class="bg-white dark:bg-[#252526] rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-2xl font-bold text-primary-600 dark:text-primary-400 overflow-hidden flex-shrink-0">
            <img v-if="profile?.avatarUrl" :src="profile.avatarUrl" class="w-full h-full object-cover" />
            <span v-else>{{ profile?.username?.charAt(0)?.toUpperCase() || '?' }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-100 truncate">{{ profile?.username }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ profile?.email }}</p>
            <p v-if="profile?.bio" class="text-sm text-gray-600 dark:text-gray-300 mt-1">{{ profile.bio }}</p>
            <p v-if="profile?.createdAt" class="text-xs text-gray-400 mt-1">注册于 {{ new Date(profile.createdAt).toLocaleDateString('zh-CN') }}</p>
          </div>
        </div>
      </div>

      <!-- 统计卡片 -->
      <div v-if="stats" class="grid grid-cols-5 gap-3 mb-6">
        <div v-for="item in [
          { label: '论文', value: stats.paperCount, icon: '📄' },
          { label: '笔记', value: stats.noteCount, icon: '📝' },
          { label: '高亮', value: stats.highlightCount, icon: '🖍' },
          { label: '对话', value: stats.chatCount, icon: '💬' },
          { label: '图谱', value: stats.graphCount, icon: '🕸' },
        ]" :key="item.label"
          class="bg-white dark:bg-[#252526] rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
          <div class="text-2xl font-bold text-gray-800 dark:text-gray-100">{{ item.value }}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ item.label }}</div>
        </div>
      </div>

      <!-- 标签页 -->
      <div class="flex border-b border-gray-200 dark:border-gray-700 mb-6">
        <button
          v-for="tab in [
            { id: 'info', label: '基本信息' },
            { id: 'security', label: '安全设置' },
            { id: 'ai', label: 'AI 设置' },
            { id: 'appearance', label: '个性设置' },
            { id: 'data', label: '数据管理' },
            { id: 'oauth', label: 'OAuth管理' },
          ]" :key="tab.id"
          @click="activeTab = tab.id as any"
          :class="[
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === tab.id
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          ]"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- ==================== 基本信息 ==================== -->
      <div v-if="activeTab === 'info'" class="bg-white dark:bg-[#252526] rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div v-if="!editMode" class="space-y-4">
          <div>
            <label class="text-xs text-gray-500 dark:text-gray-400">用户名</label>
            <p class="text-gray-800 dark:text-gray-100">{{ profile?.username }}</p>
          </div>
          <div>
            <label class="text-xs text-gray-500 dark:text-gray-400">邮箱</label>
            <p class="text-gray-800 dark:text-gray-100">{{ profile?.email }}</p>
          </div>
          <div>
            <label class="text-xs text-gray-500 dark:text-gray-400">个人简介</label>
            <p class="text-gray-800 dark:text-gray-100">{{ profile?.bio || '暂无简介' }}</p>
          </div>
          <button @click="startEdit" class="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">编辑资料</button>
          <button @click="authStore.handleLogout()" class="w-full px-4 py-3 text-sm text-red-600 border border-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium">退出登录</button>
        </div>

        <div v-else class="space-y-4">
          <div>
            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">用户名</label>
            <input v-model="editForm.username" type="text" class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1e1e1e] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">个人简介</label>
            <textarea v-model="editForm.bio" rows="3" class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1e1e1e] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none" placeholder="介绍一下你自己..." />
          </div>
          <div class="flex gap-2">
            <button @click="saveProfile" class="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">保存</button>
            <button @click="editMode = false" class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">取消</button>
          </div>
          <p v-if="profileError" class="text-sm text-red-500">{{ profileError }}</p>
        </div>
      </div>

      <!-- ==================== 安全设置 ==================== -->
      <div v-if="activeTab === 'security'" class="bg-white dark:bg-[#252526] rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 class="text-base font-medium text-gray-800 dark:text-gray-100 mb-4">修改密码</h3>
        <div class="space-y-3 max-w-sm">
          <div>
            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">当前密码</label>
            <div class="relative">
              <input v-model="passwordForm.oldPassword" :type="showOldPassword ? 'text' : 'password'" class="w-full px-3 py-2 pr-10 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1e1e1e] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none" />
              <button type="button" tabindex="-1" @click="showOldPassword = !showOldPassword" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg v-if="showOldPassword" class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
          </div>
          <div>
            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">新密码</label>
            <div class="relative">
              <input v-model="passwordForm.newPassword" :type="showNewPassword ? 'text' : 'password'" class="w-full px-3 py-2 pr-10 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1e1e1e] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none" />
              <button type="button" tabindex="-1" @click="showNewPassword = !showNewPassword" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg v-if="showNewPassword" class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
          </div>
          <div>
            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">确认新密码</label>
            <input v-model="passwordForm.confirmPassword" type="password" class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1e1e1e] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none" />
          </div>
          <p v-if="passwordError" class="text-sm text-red-500">{{ passwordError }}</p>
          <p v-if="passwordSuccess" class="text-sm text-green-500">密码修改成功</p>
          <button @click="changePassword" class="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">修改密码</button>
        </div>
      </div>

      <!-- ==================== AI 设置 ==================== -->
      <div v-if="activeTab === 'ai'" class="space-y-6">
        <!-- 默认翻译语言 -->
        <div class="bg-white dark:bg-[#252526] rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 class="text-base font-medium text-gray-800 dark:text-gray-100 mb-3">默认翻译语言</h3>
          <select
            :value="selectedLang"
            @change="changeLang(($event.target as HTMLSelectElement).value)"
            class="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1e1e1e] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
          >
            <option v-for="opt in translationLangOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>

        <!-- LLM API Key 管理 -->
        <div class="bg-white dark:bg-[#252526] rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-medium text-gray-800 dark:text-gray-100">LLM API Key 管理</h3>
            <button @click="startAddKey" class="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
              + 添加
            </button>
          </div>

          <div v-if="profileStore.llmKeys.length === 0" class="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
            暂无自定义 API Key 配置
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="(key, index) in profileStore.llmKeys" :key="index"
              class="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#1e1e1e] rounded-lg border border-gray-100 dark:border-gray-700"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-gray-800 dark:text-gray-100">{{ key.name }}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ key.apiBase }}</div>
                <div class="text-xs text-gray-400 dark:text-gray-500 font-mono">{{ maskKey(key.apiKey) }}</div>
              </div>
              <div class="flex gap-2 ml-3 flex-shrink-0">
                <button @click="startEditKey(index)" class="text-xs text-primary-500 hover:text-primary-600 transition-colors">编辑</button>
                <button @click="removeKey(index)" class="text-xs text-red-500 hover:text-red-600 transition-colors">删除</button>
              </div>
            </div>
          </div>

          <!-- 添加/编辑 Key 表单 -->
          <div v-if="showAddKey" class="mt-4 p-4 bg-gray-50 dark:bg-[#1e1e1e] rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
            <div>
              <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">模型名称 (Model ID)</label>
              <input v-model="newKeyForm.name" type="text" placeholder="e.g. deepseek-chat" class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#252526] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">API Base URL</label>
              <input v-model="newKeyForm.apiBase" type="text" placeholder="https://api.example.com/v1" class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#252526] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">API Key</label>
              <input v-model="newKeyForm.apiKey" type="password" placeholder="sk-..." class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#252526] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <p v-if="keyFormError" class="text-sm text-red-500">{{ keyFormError }}</p>
            <div class="flex gap-2">
              <button @click="saveKey" class="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
                {{ editingKeyIndex !== null ? '更新' : '添加' }}
              </button>
              <button @click="showAddKey = false" class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">取消</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ==================== 个性设置 ==================== -->
      <div v-if="activeTab === 'appearance'" class="bg-white dark:bg-[#252526] rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 class="text-base font-medium text-gray-800 dark:text-gray-100 mb-4">阅读器设置</h3>
        <div class="space-y-4">
          <!-- 自动隐藏折叠侧边栏 -->
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-800 dark:text-gray-100">自动隐藏收缩的侧边栏</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">当鼠标移开收缩的左边栏时完全隐藏，移动到最左侧时显示</p>
            </div>
            <button
              @click="autoHideCollapsedSidebar = !autoHideCollapsedSidebar"
              :class="[
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800',
                autoHideCollapsedSidebar ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
              ]"
            >
              <span
                :class="[
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  autoHideCollapsedSidebar ? 'translate-x-6' : 'translate-x-1'
                ]"
              />
            </button>
          </div>
        </div>
      </div>

      <!-- ==================== OAuth 管理 ==================== -->
      <div v-if="activeTab === 'oauth'" class="space-y-6">
        <!-- API Key 管理 -->
        <div class="bg-white dark:bg-[#252526] rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-base font-medium text-gray-800 dark:text-gray-100">API Key 管理</h3>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {{ apiKeys.length + expiredApiKeys.length }} / {{ apiKeyMaxAllowed }}
            </span>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            使用 API Key 可以直接登录，无需输入邮箱和密码。每个用户最多可创建 {{ apiKeyMaxAllowed }} 个 API Key。
          </p>
          
          <!-- 新创建的 API Key 显示 -->
          <div v-if="newlyCreatedApiKey" class="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <div class="flex items-start gap-3">
              <svg class="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              <div class="flex-1">
                <p class="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">请立即复制您的新 API Key</p>
                <p class="text-xs text-amber-700 dark:text-amber-300 mb-3">此 API Key 仅显示一次，离开此页面后将无法再次查看完整内容。</p>
                <div class="flex gap-2">
                  <code class="flex-1 px-3 py-2 bg-white dark:bg-[#1e1e1e] rounded border border-amber-300 dark:border-amber-700 text-sm font-mono text-gray-800 dark:text-gray-100 break-all">{{ newlyCreatedApiKey }}</code>
                  <button 
                    @click="copyApiKey(newlyCreatedApiKey)" 
                    class="px-3 py-2 text-sm bg-amber-100 dark:bg-amber-800 text-amber-700 dark:text-amber-200 rounded hover:bg-amber-200 dark:hover:bg-amber-700 transition-colors flex items-center gap-1"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                    复制
                  </button>
                </div>
                <button 
                  @click="closeNewApiKeyDisplay" 
                  class="mt-3 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                >
                  已完成复制
                </button>
              </div>
            </div>
          </div>
          
          <!-- 创建 API Key 按钮 -->
          <button 
            v-if="!showCreateApiKey && apiKeys.length + expiredApiKeys.length < apiKeyMaxAllowed"
            @click="showCreateApiKey = true" 
            class="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            + 创建 API Key
          </button>
          
          <div v-else-if="apiKeys.length + expiredApiKeys.length >= apiKeyMaxAllowed" class="text-sm text-amber-600 dark:text-amber-400 py-2">
            已达到最大数量限制 ({{ apiKeyMaxAllowed }} 个)，请先删除一些 API Key
          </div>

          <div v-if="apiKeyLoading" class="mt-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
            加载中...
          </div>
          
          <!-- 创建 API Key 表单 -->
          <div v-if="showCreateApiKey" class="mt-4 p-4 bg-gray-50 dark:bg-[#1e1e1e] rounded-lg border border-gray-200 dark:border-gray-700 space-y-4">
            <div>
              <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">名称（可选）</label>
              <input 
                v-model="newApiKeyForm.name" 
                type="text" 
                placeholder="例如：开发环境使用" 
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#252526] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">过期时间（可选）</label>
              <select 
                v-model="newApiKeyForm.expiresInDays"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#252526] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                <option value="">永不过期</option>
                <option value="7">7 天</option>
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="365">1 年</option>
              </select>
            </div>
            <p v-if="apiKeyError" class="text-sm text-red-500">{{ apiKeyError }}</p>
            <div class="flex gap-2">
              <button 
                @click="createApiKey" 
                :disabled="apiKeyLoading"
                class="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {{ apiKeyLoading ? '创建中...' : '创建' }}
              </button>
              <button 
                @click="showCreateApiKey = false; newApiKeyForm = { name: '', expiresInDays: '' }; apiKeyError = ''" 
                class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
          
          <!-- API Key 列表 -->
          <div v-if="apiKeys.length > 0" class="mt-6">
            <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">有效的 API Keys</h4>
            <div class="space-y-3">
              <div 
                v-for="key in apiKeys" 
                :key="key.id"
                class="p-4 bg-gray-50 dark:bg-[#1e1e1e] rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <div class="flex items-start justify-between">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-sm font-medium text-gray-800 dark:text-gray-100">{{ key.name }}</span>
                      <span class="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded">有效</span>
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                      <p>Key: {{ key.prefix }}</p>
                      <p>创建于: {{ formatDate(key.createdAt) }}</p>
                      <p v-if="key.expiresAt">过期于: {{ formatDate(key.expiresAt) }}</p>
                      <p v-if="key.lastUsedAt">最后使用: {{ formatDate(key.lastUsedAt) }}</p>
                      <p v-else>从未使用</p>
                    </div>
                  </div>
                  <button 
                    @click="deleteApiKey(key.id)" 
                    :disabled="apiKeyLoading"
                    class="ml-3 px-3 py-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <!-- 已过期的 API Keys -->
          <div v-if="expiredApiKeys.length > 0" class="mt-6">
            <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">已过期</h4>
            <div class="space-y-3">
              <div 
                v-for="key in expiredApiKeys" 
                :key="key.id"
                class="p-4 bg-gray-100 dark:bg-[#1a1a1a] rounded-lg border border-gray-200 dark:border-gray-700 opacity-60"
              >
                <div class="flex items-start justify-between">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-sm font-medium text-gray-600 dark:text-gray-400 line-through">{{ key.name }}</span>
                      <span class="px-2 py-0.5 text-xs bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-400 rounded">已过期</span>
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      <p>Key: {{ key.prefix }}</p>
                      <p>过期于: {{ formatDate(key.expiresAt) }}</p>
                    </div>
                  </div>
                  <button 
                    @click="deleteApiKey(key.id)" 
                    :disabled="apiKeyLoading"
                    class="ml-3 px-3 py-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div v-if="!apiKeyLoading && apiKeys.length === 0 && expiredApiKeys.length === 0" class="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
            暂无 API Key，点击上方按钮创建
          </div>
          
          <div v-if="apiKeyError && !showCreateApiKey" class="mt-4 text-sm text-red-500">
            {{ apiKeyError }}
          </div>
        </div>


      </div>

      <!-- ==================== 数据管理 ==================== -->
      <div v-if="activeTab === 'data'" class="space-y-6">
        <!-- 导出数据 -->
        <div class="bg-white dark:bg-[#252526] rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 class="text-base font-medium text-gray-800 dark:text-gray-100 mb-2">导出数据</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">导出你的所有笔记、高亮和论文数据</p>
          <button @click="handleExport" class="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-600">
            导出我的数据
          </button>
          <p v-if="exportHint" class="mt-3 text-sm text-gray-500 dark:text-gray-400">{{ exportHint }}</p>
        </div>

        <!-- 删除账号 -->
        <div class="bg-white dark:bg-[#252526] rounded-xl border border-red-200 dark:border-red-900/50 p-6">
          <h3 class="text-base font-medium text-red-600 dark:text-red-400 mb-2">危险区域</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">删除账号将永久清除你的所有数据，此操作不可恢复。</p>
          <button
            v-if="!showDeleteConfirm"
            @click="showDeleteConfirm = true"
            class="px-4 py-2 text-sm text-red-600 border border-red-300 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            删除账号
          </button>

          <div v-else class="space-y-3 max-w-sm">
            <p class="text-sm text-red-500 font-medium">请输入密码以确认删除：</p>
            <div class="relative">
              <input v-model="deletePassword" :type="showDeletePassword ? 'text' : 'password'" placeholder="输入当前密码" class="w-full px-3 py-2 pr-10 text-sm border border-red-300 dark:border-red-800 rounded-lg bg-white dark:bg-[#1e1e1e] text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-red-500 focus:border-red-500 outline-none" />
              <button type="button" tabindex="-1" @click="showDeletePassword = !showDeletePassword" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg v-if="showDeletePassword" class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
            <p v-if="deleteError" class="text-sm text-red-500">{{ deleteError }}</p>
            <div class="flex gap-2">
              <button @click="handleDeleteAccount" class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">确认删除</button>
              <button @click="showDeleteConfirm = false; deletePassword = ''; deleteError = ''" class="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">取消</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
