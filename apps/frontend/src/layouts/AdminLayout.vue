<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const username = computed(() => authStore.user?.username || '')

const navItems = [
  { name: 'admin-dashboard', label: 'Dashboard', icon: 'chart' },
  { name: 'admin-users', label: '用户管理', icon: 'users' },
  { name: 'admin-invite-codes', label: '邀请码管理', icon: 'ticket' },
]

const isActive = (name: string) => route.name === name

const goBack = () => router.push('/')
</script>

<template>
  <div class="admin-root">
    <!-- 侧边栏 -->
    <aside class="admin-sidebar">
      <div class="sidebar-header">
        <button @click="goBack" class="back-btn" title="返回首页">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span class="sidebar-title">管理后台</span>
      </div>

      <nav class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          :class="['nav-item', { active: isActive(item.name) }]"
        >
          <!-- Dashboard icon -->
          <svg v-if="item.icon === 'chart'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <!-- Users icon -->
          <svg v-if="item.icon === 'users'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <!-- Ticket / invite code icon -->
          <svg v-if="item.icon === 'ticket'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
            <path d="M13 5v2" />
            <path d="M13 17v2" />
            <path d="M13 11v2" />
          </svg>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <div class="admin-badge">
          <span class="admin-avatar">{{ username.charAt(0).toUpperCase() }}</span>
          <span class="admin-name">{{ username }}</span>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="admin-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.admin-root {
  display: flex;
  height: 100vh;
  background: var(--c-bg-primary);
  color: var(--c-text-primary);
}

.admin-sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--c-bg-elevated);
  border-right: var(--border-width) solid var(--c-border-light);
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-4);
  border-bottom: var(--border-width) solid var(--c-border-light);
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  color: var(--c-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  transition: background var(--duration-fast);
}
.back-btn:hover {
  background: var(--c-bg-hover);
  color: var(--c-text-primary);
}

.sidebar-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--c-text-primary);
}

.sidebar-nav {
  flex: 1;
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-0\.5);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--c-text-secondary);
  text-decoration: none;
  transition: all var(--duration-fast);
}
.nav-item:hover {
  background: var(--c-bg-hover);
  color: var(--c-text-primary);
}
.nav-item.active {
  background: var(--c-accent-light);
  color: var(--c-accent);
  font-weight: 500;
}

.sidebar-footer {
  padding: var(--space-3) var(--space-4);
  border-top: var(--border-width) solid var(--c-border-light);
}

.admin-badge {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.admin-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--c-accent), var(--c-accent-hover));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.admin-name {
  font-size: var(--text-xs);
  color: var(--c-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-main {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
}
</style>
