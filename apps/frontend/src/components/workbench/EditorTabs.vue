<script setup lang="ts">
import type { WorkbenchTab } from '../../types/workbench'

defineProps<{
  tabs: WorkbenchTab[]
  activeTabId: string | null
}>()

const emit = defineEmits<{
  activate: [tabId: string]
  close: [tabId: string]
  closeOthers: [tabId: string]
}>()
</script>

<template>
  <div class="editor-tabs" role="tablist" aria-label="Editor tabs">
    <div v-if="tabs.length === 0" class="editor-tabs__empty">No open editors</div>
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="editor-tabs__item"
      :class="{ 'editor-tabs__item--active': tab.id === activeTabId }"
      role="tab"
      :aria-selected="tab.id === activeTabId"
    >
      <button
        class="editor-tabs__trigger"
        @click="emit('activate', tab.id)"
        @auxclick="(event) => event.button === 1 ? emit('close', tab.id) : null"
      >
      <span class="editor-tabs__label">{{ tab.title }}</span>
      </button>
      <button
        class="editor-tabs__close"
        title="Close"
        @click.stop="emit('close', tab.id)"
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <button
        v-if="tab.id === activeTabId && tabs.length > 1"
        class="editor-tabs__menu"
        title="Close Others"
        @click.stop="emit('closeOthers', tab.id)"
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6h.01M12 12h.01M12 18h.01" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.editor-tabs {
  width: 100%;
  min-width: 0;
  height: 40px;
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  background: var(--c-bg-elevated);
  border-bottom: var(--border-width) solid var(--c-border-light);
}

.editor-tabs__empty {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  color: var(--c-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.editor-tabs__item {
  min-width: 160px;
  max-width: 280px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 12px;
  border-right: var(--border-width) solid var(--c-border-light);
  color: var(--c-text-secondary);
  background: transparent;
  transition: all var(--duration-fast) var(--ease-default);
}

.editor-tabs__item:hover {
  background: var(--c-bg-hover);
  color: var(--c-text-primary);
}

.editor-tabs__item--active {
  background: var(--c-bg-primary);
  color: var(--c-text-primary);
}

.editor-tabs__trigger {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: inline-flex;
  align-items: center;
  background: transparent;
  color: inherit;
}

.editor-tabs__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
}

.editor-tabs__close,
.editor-tabs__menu {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--c-text-muted);
}

.editor-tabs__close:hover,
.editor-tabs__menu:hover {
  background: var(--c-bg-hover);
  color: var(--c-text-primary);
}

.editor-tabs__close svg,
.editor-tabs__menu svg {
  width: 12px;
  height: 12px;
}
</style>
