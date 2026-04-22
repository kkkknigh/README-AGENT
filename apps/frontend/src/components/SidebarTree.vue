<script setup lang="ts">
import type { WorkspaceNodeDto } from "@readmeclaw/shared-ui"

defineProps<{
  items: WorkspaceNodeDto[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [workspaceId: string]
}>()
</script>

<template>
  <div class="tree">
    <button
      v-for="item in items"
      :key="item.id"
      class="tree__item"
      :class="{ 'tree__item--active': item.id === selectedId }"
      @click="emit('select', item.id)"
    >
      <span class="tree__item-indent" :style="{ width: `${Math.max(item.path.split('/').length - 1, 0) * 14}px` }"></span>
      <span class="tree__folder"></span>
      <span class="tree__label">{{ item.name }}</span>
    </button>
  </div>
</template>
