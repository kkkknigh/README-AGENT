<script setup lang="ts">
import { ref, watch } from 'vue'
import type { GraphEdgeRecord } from '../../api'
import RelationTypeSelect from './RelationTypeSelect.vue'

const props = defineProps<{
  edge: GraphEdgeRecord
  isSaving: boolean
  isDeleting: boolean
}>()

const emit = defineEmits<{
  save: [payload: { relation_type?: string; description?: string }]
  delete: [edgeId: string]
}>()

const form = ref({ relation: '', description: '' })

watch(
  () => props.edge,
  (edge) => {
    form.value = { relation: edge.relation_type, description: edge.description ?? '' }
  },
  { immediate: true },
)

function save() {
  emit('save', {
    relation_type: form.value.relation.trim() || props.edge.relation_type,
    description: form.value.description.trim() || undefined,
  })
}

function remove() {
  if (!window.confirm('确定删除这条关系吗？')) return
  emit('delete', props.edge.id)
}
</script>

<template>
  <div class="rounded-2xl border border-[var(--c-border-light)] bg-[var(--c-bg-secondary)] p-4 space-y-3">
    <p class="text-sm font-bold">关系编辑</p>
    <div>
      <label class="mb-1 block text-xs font-bold text-[var(--c-text-secondary)]">关系类型</label>
      <RelationTypeSelect v-model="form.relation" />
    </div>
    <div>
      <label class="mb-1 block text-xs font-bold text-[var(--c-text-secondary)]">关系说明</label>
      <textarea v-model="form.description" class="w-full rounded-xl border border-[var(--c-border-input)] bg-[var(--c-bg-input)] px-3 py-2 text-sm min-h-[72px]"></textarea>
    </div>
    <div class="flex justify-end gap-2">
      <button class="rounded-xl border border-red-200 bg-[var(--c-error-bg)] px-3 py-2 text-xs font-semibold text-[var(--c-error)]" :disabled="isDeleting" @click="remove">
        {{ isDeleting ? '删除中...' : '删除关系' }}
      </button>
      <button class="rounded-xl bg-[var(--c-accent)] px-3 py-2 text-xs font-semibold text-white" :disabled="isSaving" @click="save">
        {{ isSaving ? '保存中...' : '保存关系' }}
      </button>
    </div>
  </div>
</template>
