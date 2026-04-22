<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { adminApi } from '../../api'

// ==================== 状态 ====================

interface InviteItem {
  id: number
  code: string
  batch: number
  sequence: number
  ownerUsername: string | null
  ownerEmail: string | null
  useCount: number
  remainingUses: number
  createdAt: string | null
}

const items = ref<InviteItem[]>([])
const total = ref(0)
const page = ref(1)
const perPage = ref(20)
const search = ref('')
const filterBatch = ref('')
const loading = ref(true)
const error = ref('')

// 编辑状态
const editingId = ref<number | null>(null)
const editRemainingUses = ref(0)
const saving = ref(false)

// 删除状态
const deletingId = ref<number | null>(null)
const deleting = ref(false)

// 批量操作状态
const batchMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const batchDeleting = ref(false)

const allSelected = computed(() =>
  items.value.length > 0 && items.value.every(i => selectedIds.value.has(i.id))
)

function toggleBatchMode() {
  batchMode.value = !batchMode.value
  selectedIds.value = new Set()
}

function toggleSelect(id: number) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedIds.value = s
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(items.value.map(i => i.id))
  }
}

async function doBatchDelete() {
  if (selectedIds.value.size === 0) return
  batchDeleting.value = true
  try {
    await adminApi.batchDeleteInviteCodes([...selectedIds.value])
    selectedIds.value = new Set()
    await fetchData()
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to batch delete'
  } finally {
    batchDeleting.value = false
  }
}

// 新建状态
const showCreate = ref(false)
const createOwner = ref('')
const createRemainingUses = ref(20)
const createBatch = ref(0)
const createCount = ref(1)
const creating = ref(false)

// ==================== 数据获取 ====================

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function fetchData() {
  loading.value = true
  error.value = ''
  try {
    const data = await adminApi.listInviteCodes({
      page: page.value,
      perPage: perPage.value,
      search: search.value || undefined,
      batch: filterBatch.value !== '' ? Number(filterBatch.value) : undefined,
    })
    items.value = data.items
    total.value = data.total
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to load invite codes'
  } finally {
    loading.value = false
  }
}

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    fetchData()
  }, 300)
})

let batchTimer: ReturnType<typeof setTimeout> | null = null

watch(filterBatch, () => {
  if (batchTimer) clearTimeout(batchTimer)
  batchTimer = setTimeout(() => {
    page.value = 1
    fetchData()
  }, 300)
})

fetchData()

// ==================== 分页 ====================

const totalPages = () => Math.ceil(total.value / perPage.value)

function goPage(p: number) {
  if (p < 1 || p > totalPages()) return
  page.value = p
  fetchData()
}

// ==================== 编辑 ====================

function startEdit(item: InviteItem) {
  editingId.value = item.id
  editRemainingUses.value = item.remainingUses
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(id: number) {
  saving.value = true
  try {
    await adminApi.updateInviteCode(id, { remainingUses: editRemainingUses.value })
    editingId.value = null
    await fetchData()
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to update invite code'
  } finally {
    saving.value = false
  }
}

// ==================== 新建 ====================

function openCreate() {
  createOwner.value = ''
  createRemainingUses.value = 20
  createBatch.value = 0
  createCount.value = 1
  showCreate.value = true
}

function cancelCreate() {
  showCreate.value = false
}

async function doCreate() {
  creating.value = true
  try {
    await adminApi.createInviteCode({
      owner: createOwner.value || undefined,
      remainingUses: createRemainingUses.value,
      batch: createBatch.value,
      count: createCount.value,
    })
    showCreate.value = false
    await fetchData()
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to create invite code'
  } finally {
    creating.value = false
  }
}

// ==================== 删除 ====================

function confirmDelete(id: number) {
  deletingId.value = id
}

function cancelDelete() {
  deletingId.value = null
}

async function doDelete(id: number) {
  deleting.value = true
  try {
    await adminApi.deleteInviteCode(id)
    deletingId.value = null
    await fetchData()
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to delete invite code'
  } finally {
    deleting.value = false
  }
}

// ==================== 工具函数 ====================

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

</script>

<template>
  <div class="codes-page">
    <div class="page-header">
      <h1 class="page-title">邀请码管理</h1>
      <div class="header-actions">
        <button @click="openCreate" class="create-btn">+ 新建邀请码</button>
        <button @click="toggleBatchMode" :class="['batch-mode-btn', { active: batchMode }]">
          {{ batchMode ? '退出批量' : '批量操作' }}
        </button>
      </div>
    </div>

    <!-- 批量操作栏 -->
    <div v-if="batchMode && selectedIds.size > 0" class="batch-bar">
      <span>已选 {{ selectedIds.size }} 条</span>
      <button @click="doBatchDelete" :disabled="batchDeleting" class="action-btn danger">
        {{ batchDeleting ? '删除中...' : '批量删除' }}
      </button>
      <button @click="selectedIds = new Set()" class="action-btn cancel">取消选择</button>
    </div>

    <!-- 新建表单 -->
    <div v-if="showCreate" class="create-form">
      <div class="form-row">
        <label class="form-label">
          Owner 用户 ID 或邮箱（可选）
          <input v-model="createOwner" type="text" placeholder="留空则不指定" class="form-input" />
        </label>
        <label class="form-label">
          批次
          <input v-model.number="createBatch" type="number" min="0" max="127" class="form-input short" />
        </label>
        <label class="form-label">
          可用次数
          <input v-model.number="createRemainingUses" type="number" min="0" class="form-input short" />
        </label>
        <label class="form-label">
          数量
          <input v-model.number="createCount" type="number" min="1" max="50" class="form-input short" />
        </label>
        <div class="form-actions">
          <button @click="doCreate" :disabled="creating" class="action-btn save">
            {{ creating ? '创建中...' : '创建' }}
          </button>
          <button @click="cancelCreate" class="action-btn cancel">取消</button>
        </div>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <input
        v-model="search"
        type="text"
        placeholder="搜索邀请码或用户名..."
        class="search-input"
      />
      <input
        v-model="filterBatch"
        type="number"
        min="0"
        max="127"
        placeholder="筛选批次..."
        class="filter-batch-input"
      />
      <span class="total-count">共 {{ total }} 条</span>
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

    <!-- 表格 -->
    <div v-else class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th v-if="batchMode" class="cell-checkbox">
              <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
            </th>
            <th>邀请码</th>
            <th>所属用户</th>
            <th>批次</th>
            <th>已邀请</th>
            <th>剩余次数</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td v-if="batchMode" class="cell-checkbox">
              <input type="checkbox" :checked="selectedIds.has(item.id)" @change="toggleSelect(item.id)" />
            </td>
            <td class="cell-code">{{ item.code }}</td>
            <td class="cell-owner">
              <template v-if="item.ownerUsername">
                <span class="owner-name">{{ item.ownerUsername }}</span>
                <span class="owner-email">{{ item.ownerEmail }}</span>
              </template>
              <span v-else class="text-muted">-</span>
            </td>
            <td>
              <span class="batch-badge">{{ item.batch }}</span>
            </td>
            <td class="cell-count">{{ item.useCount }}</td>

            <!-- 剩余次数列 -->
            <td>
              <template v-if="editingId === item.id">
                <input
                  v-model.number="editRemainingUses"
                  type="number"
                  min="0"
                  class="inline-input"
                />
              </template>
              <template v-else>
                <span :class="['remaining', { exhausted: item.remainingUses === 0 }]">
                  {{ item.remainingUses }}
                </span>
              </template>
            </td>

            <td class="cell-date">{{ formatDate(item.createdAt) }}</td>

            <!-- 操作列 -->
            <td class="cell-actions">
              <template v-if="editingId === item.id">
                <button @click="saveEdit(item.id)" :disabled="saving" class="action-btn save">
                  {{ saving ? '保存中...' : '保存' }}
                </button>
                <button @click="cancelEdit" class="action-btn cancel">取消</button>
              </template>
              <template v-else-if="deletingId === item.id">
                <span class="confirm-text">确认删除？</span>
                <button @click="doDelete(item.id)" :disabled="deleting" class="action-btn danger">
                  {{ deleting ? '删除中...' : '确认' }}
                </button>
                <button @click="cancelDelete" class="action-btn cancel">取消</button>
              </template>
              <template v-else>
                <button @click="startEdit(item)" class="action-btn edit">编辑</button>
                <button @click="confirmDelete(item.id)" class="action-btn danger">删除</button>
              </template>
            </td>
          </tr>
          <tr v-if="items.length === 0">
            <td :colspan="batchMode ? 8 : 7" class="empty-row">暂无邀请码数据</td>
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
.codes-page {
  max-width: 1100px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--c-text-primary);
}

.header-actions {
  display: flex;
  gap: var(--space-2);
}

.batch-mode-btn {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--c-text-secondary);
  background: var(--c-bg-elevated);
  border: var(--border-width) solid var(--c-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.batch-mode-btn:hover {
  background: var(--c-bg-hover);
  color: var(--c-text-primary);
}
.batch-mode-btn.active {
  color: var(--c-error);
  border-color: var(--c-error);
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
  background: var(--c-error-bg);
  border: var(--border-width) solid var(--c-error-border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--c-text-primary);
}

.cell-checkbox {
  width: 32px;
  text-align: center;
}

.cell-checkbox input[type="checkbox"] {
  accent-color: var(--c-accent);
  cursor: pointer;
}

.create-btn {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  color: white;
  background: var(--c-accent);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast);
}
.create-btn:hover {
  background: var(--c-accent-hover);
}

/* ==================== 新建表单 ==================== */

.create-form {
  padding: var(--space-4);
  margin-bottom: var(--space-4);
  background: var(--c-bg-elevated);
  border: var(--border-width) solid var(--c-border-light);
  border-radius: var(--radius-lg);
}

.form-row {
  display: flex;
  align-items: flex-end;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.form-label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--c-text-muted);
}

.form-input {
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  border: var(--border-width) solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-bg-primary);
  color: var(--c-text-primary);
  outline: none;
  min-width: 220px;
}
.form-input:focus {
  border-color: var(--c-accent);
}
.form-input.short {
  min-width: 100px;
  width: 100px;
}

.form-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
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

.filter-batch-input {
  width: 110px;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  border: var(--border-width) solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-bg-elevated);
  color: var(--c-text-primary);
  outline: none;
  transition: border-color var(--duration-fast);
}
.filter-batch-input:focus {
  border-color: var(--c-accent);
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

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.data-table th {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  font-weight: 500;
  color: var(--c-text-muted);
  border-bottom: var(--border-width) solid var(--c-border-light);
  white-space: nowrap;
}

.data-table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--border-width) solid var(--c-border-light);
  vertical-align: middle;
}

.data-table tbody tr:last-child td {
  border-bottom: none;
}

.data-table tbody tr:hover {
  background: var(--c-bg-hover);
}

.cell-code {
  font-family: monospace;
  font-weight: 600;
  color: var(--c-text-primary);
  letter-spacing: 0.05em;
}

.cell-owner {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.owner-name {
  font-weight: 500;
  color: var(--c-text-primary);
}

.owner-email {
  font-size: var(--text-xs);
  color: var(--c-text-muted);
}

.text-muted {
  color: var(--c-text-muted);
}

.cell-count {
  font-weight: 500;
  color: var(--c-text-primary);
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

/* ==================== 批次 & 剩余 ==================== */

.batch-badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: var(--text-xs);
  border-radius: var(--radius-full);
  font-weight: 500;
  background: var(--c-bg-hover);
  color: var(--c-text-secondary);
}

.remaining {
  font-weight: 500;
  color: var(--c-text-primary);
}

.remaining.exhausted {
  color: var(--c-error);
}

/* ==================== 行内编辑 ==================== */

.inline-input {
  width: 70px;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  border: var(--border-width) solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-bg-primary);
  color: var(--c-text-primary);
  outline: none;
}
.inline-input:focus {
  border-color: var(--c-accent);
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
.action-btn.danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
