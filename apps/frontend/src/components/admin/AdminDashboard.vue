<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { adminApi } from '../../api'

const loading = ref(true)
const error = ref('')

const stats = ref<{
  totalUsers: number
  activeToday: number
  totalDocuments: number
  totalChats: number
} | null>(null)

const growth = ref<Array<{
  date: string
  newUsers: number
  activeUsers: number
  newDocuments: number
}>>([])

async function fetchDashboard() {
  loading.value = true
  error.value = ''
  try {
    const data = await adminApi.getDashboard()
    stats.value = data.stats
    growth.value = data.growth
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to load dashboard'
  } finally {
    loading.value = false
  }
}

onMounted(fetchDashboard)

// 折线图数据处理
const chartData = computed(() => {
  if (!growth.value.length) return null
  const maxUsers = Math.max(...growth.value.map(d => d.activeUsers), 1)
  const maxNewUsers = Math.max(...growth.value.map(d => d.newUsers), 1)
  const maxDocs = Math.max(...growth.value.map(d => d.newDocuments), 1)
  const maxVal = Math.max(maxUsers, maxNewUsers, maxDocs)
  return { maxVal }
})

function svgPath(key: 'newUsers' | 'activeUsers' | 'newDocuments'): string {
  if (!growth.value.length) return ''
  const maxVal = chartData.value?.maxVal || 1
  const w = 800
  const h = 200
  const padding = 2

  const points = growth.value.map((d, i) => {
    const x = padding + (i / Math.max(growth.value.length - 1, 1)) * (w - padding * 2)
    const y = h - padding - (d[key] / maxVal) * (h - padding * 2)
    return `${x},${y}`
  })
  return `M ${points.join(' L ')}`
}

const statCards = computed(() => {
  if (!stats.value) return []
  return [
    { label: '总用户', value: stats.value.totalUsers, color: 'var(--c-accent)' },
    { label: '今日活跃', value: stats.value.activeToday, color: 'var(--c-success)' },
    { label: '总文档', value: stats.value.totalDocuments, color: 'var(--c-chart-3)' },
    { label: '总对话', value: stats.value.totalChats, color: '#f59e0b' },
  ]
})
</script>

<template>
  <div class="dashboard">
    <h1 class="page-title">Dashboard</h1>

    <div v-if="loading" class="loading-state">
      <div class="spinner" />
      <span>加载中...</span>
    </div>

    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
      <button @click="fetchDashboard" class="retry-btn">重试</button>
    </div>

    <template v-else>
      <!-- 统计卡片 -->
      <div class="stats-grid">
        <div v-for="card in statCards" :key="card.label" class="stat-card">
          <div class="stat-value" :style="{ color: card.color }">{{ card.value.toLocaleString() }}</div>
          <div class="stat-label">{{ card.label }}</div>
        </div>
      </div>

      <!-- 增长趋势图 -->
      <div class="chart-section" v-if="growth.length > 0">
        <h2 class="section-title">最近 30 天趋势</h2>
        <div class="chart-legend">
          <span class="legend-item">
            <span class="legend-dot" style="background: var(--c-accent)"></span>
            新用户
          </span>
          <span class="legend-item">
            <span class="legend-dot" style="background: var(--c-success)"></span>
            活跃用户
          </span>
          <span class="legend-item">
            <span class="legend-dot" style="background: var(--c-chart-3)"></span>
            新文档
          </span>
        </div>
        <div class="chart-container">
          <svg viewBox="0 0 800 200" class="chart-svg">
            <path :d="svgPath('activeUsers')" fill="none" stroke="var(--c-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <path :d="svgPath('newUsers')" fill="none" stroke="var(--c-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <path :d="svgPath('newDocuments')" fill="none" stroke="var(--c-chart-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 960px;
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--c-text-primary);
  margin-bottom: var(--space-6);
}

.loading-state,
.error-state {
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

.retry-btn {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  color: var(--c-accent);
  background: none;
  border: 1px solid var(--c-accent);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.retry-btn:hover {
  background: var(--c-accent-light);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  margin-bottom: var(--space-8);
}

.stat-card {
  background: var(--c-bg-elevated);
  border: var(--border-width) solid var(--c-border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
}

.stat-value {
  font-size: var(--text-2xl);
  font-weight: 700;
  line-height: 1;
  margin-bottom: var(--space-1);
}

.stat-label {
  font-size: var(--text-sm);
  color: var(--c-text-muted);
}

.chart-section {
  background: var(--c-bg-elevated);
  border: var(--border-width) solid var(--c-border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
}

.section-title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--c-text-primary);
  margin-bottom: var(--space-3);
}

.chart-legend {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--c-text-secondary);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.chart-container {
  width: 100%;
  aspect-ratio: 4 / 1;
}

.chart-svg {
  width: 100%;
  height: 100%;
}
</style>
