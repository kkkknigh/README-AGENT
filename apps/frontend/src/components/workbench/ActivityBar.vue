<script setup lang="ts">
import type { ActivityId } from '../../types/workbench'

const props = defineProps<{
  active: ActivityId
  sidebarVisible: boolean
  auxVisible: boolean
}>()

const emit = defineEmits<{
  select: [activity: ActivityId]
  toggleAuxPanel: []
}>()

const items: Array<{ id: ActivityId; label: string; icon: string }> = [
  { id: 'explorer', label: 'Explorer', icon: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'library', label: 'Library', icon: 'M7 5h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2zm0 0v14' },
  { id: 'graph', label: 'Graph', icon: 'M6 7a2 2 0 110-4 2 2 0 010 4zm12 6a2 2 0 110-4 2 2 0 010 4zM8 5l8 5M8 19l8-7M6 21a2 2 0 110-4 2 2 0 010 4z' },
  { id: 'search', label: 'Search', icon: 'M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z' },
  { id: 'profile', label: 'Profile', icon: 'M12 14a5 5 0 100-10 5 5 0 000 10zm-7 7a7 7 0 0114 0' },
]

function getItemTitle(item: { id: ActivityId; label: string }) {
  if (props.active !== item.id) return `Open ${item.label}`
  return props.sidebarVisible ? `Hide ${item.label}` : `Show ${item.label}`
}

function getChatTitle() {
  return props.auxVisible ? 'Hide Chat' : 'Show Chat'
}
</script>

<template>
  <aside class="activity-bar">
    <div class="activity-bar__section">
      <button
        v-for="item in items"
        :key="item.id"
        class="activity-bar__item"
        :class="{
          'activity-bar__item--active': active === item.id && sidebarVisible,
          'activity-bar__item--selected': active === item.id && !sidebarVisible,
        }"
        :title="getItemTitle(item)"
        :aria-label="getItemTitle(item)"
        :aria-pressed="active === item.id && sidebarVisible"
        @click="emit('select', item.id)"
      >
        <svg class="activity-bar__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" :d="item.icon" />
        </svg>
      </button>
    </div>

    <div class="activity-bar__spacer"></div>

    <div class="activity-bar__section activity-bar__section--utility">
      <button
        class="activity-bar__item"
        :class="{ 'activity-bar__item--active': auxVisible }"
        :title="getChatTitle()"
        :aria-label="getChatTitle()"
        :aria-pressed="auxVisible"
        @click="emit('toggleAuxPanel')"
      >
        <svg class="activity-bar__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.activity-bar {
  width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  background: var(--c-sidebar-bg);
  background-image: linear-gradient(180deg, var(--c-sidebar-bg-start), var(--c-sidebar-bg-end));
}

.activity-bar__section {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.activity-bar__section--utility {
  padding-top: 10px;
  border-top: var(--border-width) solid var(--c-sidebar-border);
}

.activity-bar__spacer {
  flex: 1;
  min-height: 16px;
}

.activity-bar__item {
  position: relative;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--c-sidebar-text-muted);
  transition: all var(--duration-fast) var(--ease-default);
}

.activity-bar__item:hover {
  background: var(--c-sidebar-bg-hover);
  color: var(--c-sidebar-text);
}

.activity-bar__item--active {
  color: var(--c-sidebar-text);
  background: var(--c-sidebar-bg-active);
  box-shadow: inset 2px 0 0 var(--c-accent-light);
}

.activity-bar__item--selected {
  color: var(--c-sidebar-text);
}

.activity-bar__item--selected::before {
  content: '';
  position: absolute;
  left: -4px;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 999px;
  background: var(--c-accent-light);
}

.activity-bar__icon {
  width: 18px;
  height: 18px;
}
</style>
