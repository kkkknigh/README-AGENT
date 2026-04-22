<script setup lang="ts">
import type { WorkspaceDetailDto } from "@readmeclaw/shared-ui"

defineProps<{
  detail: WorkspaceDetailDto | null
}>()

const emit = defineEmits<{
  openDocument: [documentId: string]
}>()
</script>

<template>
  <section class="panel">
    <header class="panel__header">
      <div>
        <div class="panel__eyebrow">Workspace</div>
        <h2 class="panel__title">{{ detail?.workspace.name ?? "No workspace selected" }}</h2>
      </div>
      <div class="panel__meta">{{ detail?.documents.length ?? 0 }} docs</div>
    </header>

    <div class="document-list">
      <button
        v-for="doc in detail?.documents ?? []"
        :key="doc.id"
        class="document-card"
        @click="emit('openDocument', doc.id)"
      >
        <strong>{{ doc.title }}</strong>
        <span>{{ doc.authors.join(" / ") || "Unknown authors" }}</span>
        <span>Status: {{ doc.processStatus ?? "unknown" }}</span>
      </button>
    </div>
  </section>
</template>
