<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { adminApi } from '../../api'
import { useAuthStore } from '../../stores/auth'

const authStore = useAuthStore()
const isSuperAdmin = computed(() => authStore.isSuperAdmin)

// ==================== 状态 ====================

interface UserItem {
  id: string
  username: string
  email: string
  role: string
  isActive: boolean
  createdAt: string | null
  lastActiveAt: string | null
}

const users = ref<UserItem[]>([])
const total = ref(0)
const page = ref(1)
const perPage = ref(20)
const search = ref('')
const filterRole = ref('')
const filterActive = ref('')
const loading = ref(true)
const error = ref('')

// 编辑状态
const editingUserId = ref<string | null>(null)
const editRole = ref('')
const editActive = ref(true)
const saving = ref(false)

// 删除确认
const deletingUserId = ref<string | null>(null)
const deleting = ref(false)

// ==================== 数据获取 ====================

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function fetchUsers() {
  loading.value = true
  error.value = ''
  try {
    const data = await adminApi.listUsers({
      page: page.value,
      perPage: perPage.value,
      search: search.value || undefined,
      role: filterRole.value || undefined,
      isActive: filterActive.value || undefined,
    })
    users.value = data.items
    total.value = data.total
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to load users'
  } finally {
    loading.value = false
  }
}

// 搜索防抖
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    fetchUsers()
  }, 300)
})

watch([filterRole, filterActive], () => {
  page.value = 1
  fetchUsers()
})

fetchUsers()

// ==================== 分页 ====================

const totalPages = () => Math.ceil(total.value / perPage.value)

function goPage(p: number) {
  if (p < 1 || p > totalPages()) return
  page.value = p
  fetchUsers()
}

// ==================== 编辑用户 ====================

function startEdit(user: UserItem) {
  editingUserId.value = user.id
  editRole.value = user.role
  editActive.value = user.isActive
}

function cancelEdit() {
  editingUserId.value = null
}

async function saveEdit(userId: string) {
  saving.value = true
  try {
    const payload: { role?: string; isActive?: boolean } = { isActive: editActive.value }
    if (isSuperAdmin.value) {
      payload.role = editRole.value
    }
    await adminApi.updateUser(userId, payload)
    editingUserId.value = null
    await fetchUsers()
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to update user'
  } finally {
    saving.value = false
  }
}

// ==================== 删除用户 ====================

function confirmDelete(userId: string) {
  deletingUserId.value = userId
}

function cancelDelete() {
  deletingUserId.value = null
}

async function doDelete(userId: string) {
  deleting.value = true
  try {
    await adminApi.deleteUser(userId)
    deletingUserId.value = null
    await fetchUsers()
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to delete user'
  } finally {
    deleting.value = false
  }
}

// ==================== 工具函数 ====================

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const roleLabels: Record<string, string> = {
  user: '普通用户',
  admin: '管理员',
  super_admin: '超级管理员',
}
</script>

<template>
  <div class="users-page">
    <h1 class="page-title">用户管理</h1>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <input
        v-model="search"
        type="text"
        placeholder="搜索用户名或邮箱..."
        class="search-input"
      />
      <select v-model="filterRole" class="filter-select">
        <option value="">全部角色</option>
        <option value="user">普通用户</option>
        <option value="admin">管理员</option>
        <option value="super_admin">超级管理员</option>
      </select>
      <select v-model="filterActive" class="filter-select">
        <option value="">全部状态</option>
        <option value="true">正常</option>
        <option value="false">已封禁</option>
      </select>
      <span class="total-count">共 {{ total }} 人</span>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-bar">
      <span>{{ error }}</span>
      <button @click="error = ''" class="close-error">&times;</button>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      <div class="spinner" />
      <span>加载中...</span>
    </div>

    <!-- 用户表格 -->
    <div v-else class="table-wrapper">
      <table class="user-table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>邮箱</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th>最后活跃</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" :class="{ 'row-disabled': !u.isActive }">
            <td class="cell-username">{{ u.username }}</td>
            <td class="cell-email">{{ u.email }}</td>

            <!-- 角色列 -->
            <td>
              <template v-if="editingUserId === u.id && isSuperAdmin && u.role !== 'super_admin'">
                <select v-model="editRole" class="inline-select">
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </template>
              <template v-else>
                <span :class="['role-badge', `role-${u.role}`]">
                  {{ roleLabels[u.role] || u.role }}
                </span>
              </template>
            </td>

            <!-- 状态列 -->
            <td>
              <template v-if="editingUserId === u.id">
                <label class="toggle-label">
                  <input type="checkbox" v-model="editActive" class="toggle-input" />
                  <span class="toggle-text">{{ editActive ? '正常' : '封禁' }}</span>
                </label>
              </template>
              <template v-else>
                <span :class="['status-dot', u.isActive ? 'active' : 'disabled']" />
                <span class="status-text">{{ u.isActive ? '正常' : '已封禁' }}</span>
              </template>
            </td>

            <td class="cell-date">{{ formatDate(u.createdAt) }}</td>
            <td class="cell-date">{{ formatDateTime(u.lastActiveAt) }}</td>

            <!-- 操作列 -->
            <td class="cell-actions">
              <template v-if="editingUserId === u.id">
                <button @click="saveEdit(u.id)" :disabled="saving" class="action-btn save">
                  {{ saving ? '保存中...' : '保存' }}
                </button>
                <button @click="cancelEdit" class="action-btn cancel">取消</button>
              </template>
              <template v-else-if="deletingUserId === u.id">
                <span class="confirm-text">确认删除？</span>
                <button @click="doDelete(u.id)" :disabled="deleting" class="action-btn danger">
                  {{ deleting ? '删除中...' : '确认' }}
                </button>
                <button @click="cancelDelete" class="action-btn cancel">取消</button>
              </template>
              <template v-else>
                <template v-if="u.role === 'super_admin'">
                  <span class="text-xs" style="color: var(--c-text-muted)">-</span>
                </template>
                <template v-else>
                  <button @click="startEdit(u)" class="action-btn edit">编辑</button>
                  <button v-if="u.role !== 'admin' || isSuperAdmin" @click="confirmDelete(u.id)" class="action-btn danger">删除</button>
                </template>
              </template>
            </td>
          </tr>
          <tr v-if="users.length === 0">
            <td colspan="7" class="empty-row">暂无用户数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页 -->
    <div v-if="totalPages() > 1" class="pagination">
      <button @click="goPage(page - 1)" :disabled="page <= 1" class="page-btn">&lt;</button>
      <span class="page-info">{{ page }} / {{ totalPages() }}</span>
      <button @click="goPage(page + 1)" :disabled="page >= totalPages()" class="page-btn">&gt;</button>
    </div>
  </div>
</template>

<style scoped>
.users-page {
  max-width: 1100px;
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--c-text-primary);
  margin-bottom: var(--space-4);
}

/* ==================== 筛选栏 ==================== */

.filter-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
}

.search-input {
  flex: 1;
  min-width: 200px;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  border: var(--border-width) solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-bg-elevated);
  color: var(--c-text-primary);
  outline: none;
  transition: border-color var(--duration-fast);
}
.search-input:focus {
  border-color: var(--c-accent);
}

.filter-select {
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  border: var(--border-width) solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-bg-elevated);
  color: var(--c-text-primary);
  outline: none;
  cursor: pointer;
}

.total-count {
  font-size: var(--text-sm);
  color: var(--c-text-muted);
  margin-left: auto;
}

/* ==================== 错误提示 ==================== */

.error-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
  background: var(--c-error-bg);
  border: var(--border-width) solid var(--c-error);
  border-radius: var(--radius-md);
  color: var(--c-error);
  font-size: var(--text-sm);
}

.close-error {
  background: none;
  border: none;
  color: inherit;
  font-size: var(--text-lg);
  cursor: pointer;
  line-height: 1;
}

/* ==================== 加载 ==================== */

.loading-state {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-8);
  color: var(--c-text-secondary);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ==================== 表格 ==================== */

.table-wrapper {
  background: var(--c-bg-elevated);
  border: var(--border-width) solid var(--c-border-light);
  border-radius: var(--radius-lg);
  overflow-x: auto;
}

.user-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.user-table th {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  font-weight: 500;
  color: var(--c-text-muted);
  border-bottom: var(--border-width) solid var(--c-border-light);
  white-space: nowrap;
}

.user-table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--border-width) solid var(--c-border-light);
  vertical-align: middle;
}

.user-table tbody tr:last-child td {
  border-bottom: none;
}

.user-table tbody tr:hover {
  background: var(--c-bg-hover);
}

.row-disabled {
  opacity: 0.6;
}

.cell-username {
  font-weight: 500;
  color: var(--c-text-primary);
}

.cell-email {
  color: var(--c-text-secondary);
}

.cell-date {
  color: var(--c-text-muted);
  white-space: nowrap;
  font-size: var(--text-xs);
}

.empty-row {
  text-align: center;
  color: var(--c-text-muted);
  padding: var(--space-8) !important;
}

/* ==================== 角色 & 状态 ==================== */

.role-badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: var(--text-xs);
  border-radius: var(--radius-full);
  font-weight: 500;
}

.role-user {
  background: var(--c-bg-hover);
  color: var(--c-text-secondary);
}

.role-admin {
  background: var(--c-accent-light);
  color: var(--c-accent);
}

.role-super_admin {
  background: var(--c-warning-bg);
  color: var(--c-warning);
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: var(--space-1);
  vertical-align: middle;
}
.status-dot.active {
  background: var(--c-success);
}
.status-dot.disabled {
  background: var(--c-error);
}

.status-text {
  font-size: var(--text-xs);
  color: var(--c-text-secondary);
}

/* ==================== 行内编辑 ==================== */

.inline-select {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  border: var(--border-width) solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-bg-primary);
  color: var(--c-text-primary);
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  cursor: pointer;
  font-size: var(--text-xs);
}

.toggle-input {
  accent-color: var(--c-accent);
}

.toggle-text {
  color: var(--c-text-secondary);
}

/* ==================== 操作按钮 ==================== */

.cell-actions {
  white-space: nowrap;
}

.action-btn {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  margin-right: var(--space-1);
  transition: all var(--duration-fast);
}

.action-btn.edit {
  color: var(--c-accent);
  background: none;
}
.action-btn.edit:hover {
  background: var(--c-accent-light);
}

.action-btn.save {
  color: white;
  background: var(--c-accent);
}
.action-btn.save:hover {
  background: var(--c-accent-hover);
}
.action-btn.save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.cancel {
  color: var(--c-text-muted);
  background: none;
}
.action-btn.cancel:hover {
  color: var(--c-text-primary);
}

.action-btn.danger {
  color: var(--c-error);
  background: none;
}
.action-btn.danger:hover {
  background: var(--c-error-bg);
}

.confirm-text {
  font-size: var(--text-xs);
  color: var(--c-error);
  margin-right: var(--space-1);
}

/* ==================== 分页 ==================== */

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.page-btn {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  border: var(--border-width) solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-bg-elevated);
  color: var(--c-text-primary);
  cursor: pointer;
}
.page-btn:hover:not(:disabled) {
  background: var(--c-bg-hover);
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: var(--text-sm);
  color: var(--c-text-secondary);
}
</style>
