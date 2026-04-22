<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GraphNodeRecord } from '../../api'
import type { PdfDocument } from '../../types'
import { useTagStore } from '../../stores/tag'

const props = defineProps<{
  node: GraphNodeRecord
  allNodes: GraphNodeRecord[]
  allDocuments: PdfDocument[]
  isSaving: boolean
  isDeleting: boolean
}>()

const emit = defineEmits<{
  save: [payload: { label?: string; description?: string }]
  delete: [nodeId: string]
  'link-paper': [nodeId: string, paperId: string]
  'unlink-paper': [nodeId: string, paperId: string]
  'link-note': [nodeId: string, noteId: number]
  'unlink-note': [nodeId: string, noteId: number]
  'open-paper': [paperId: string]
  'paper-contextmenu': [paperId: string, event: MouseEvent]
}>()

const tagStore = useTagStore()
const form = ref({ label: '', description: '' })
const showAddPaper = ref(false)
const paperSearch = ref('')
const showAddNote = ref(false)
const noteIdInput = ref('')

watch(
  () => props.node,
  (node) => {
    form.value = { label: node.label, description: node.description ?? '' }
    showAddPaper.value = false
    showAddNote.value = false
    paperSearch.value = ''
    noteIdInput.value = ''
  },
  { immediate: true },
)

// 关联论文：从 allDocuments 中匹配
const linkedPapers = computed(() => {
  const ids = new Set(props.node.linked_paper_ids ?? [])
  return props.allDocuments.filter((doc) => ids.has(doc.id))
})

// 可添加的论文（未关联的）
const availablePapers = computed(() => {
  const ids = new Set(props.node.linked_paper_ids ?? [])
  const keyword = paperSearch.value.toLowerCase().trim()
  return props.allDocuments
    .filter((doc) => !ids.has(doc.id))
    .filter((doc) => !keyword || doc.name.toLowerCase().includes(keyword))
    .slice(0, 20)
})


function save() {
  emit('save', {
    label: form.value.label.trim(),
    description: form.value.description.trim() || undefined,
  })
}

function remove() {
  if (!window.confirm(`确定删除节点"${props.node.label}"吗？相关关系也会一并删除。`)) return
  emit('delete', props.node.id)
}

function addPaper(paperId: string) {
  emit('link-paper', props.node.id, paperId)
  showAddPaper.value = false
  paperSearch.value = ''
}

function removePaper(paperId: string) {
  emit('unlink-paper', props.node.id, paperId)
}

function addNote() {
  const id = parseInt(noteIdInput.value.trim())
  if (isNaN(id)) return
  emit('link-note', props.node.id, id)
  noteIdInput.value = ''
  showAddNote.value = false
}

function removeNote(noteId: number) {
  emit('unlink-note', props.node.id, noteId)
}
</script>

<template>
  <div class="space-y-4">
    <!-- 节点基本信息 -->
    <div class="rounded-2xl border border-[var(--c-border-light)] bg-[var(--c-bg-secondary)] p-4 space-y-3">
      <div class="flex items-center gap-2">
        <span class="h-3 w-3 rounded-full shrink-0" :style="{ background: tagStore.getTagColor(node.label) }"></span>
        <p class="text-sm font-bold flex-1">节点信息</p>
      </div>
      <div>
        <label class="mb-1 block text-xs font-bold text-[var(--c-text-secondary)]">标签名</label>
        <input v-model="form.label" type="text" class="w-full rounded-xl border border-[var(--c-border-input)] bg-[var(--c-bg-input)] px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="mb-1 block text-xs font-bold text-[var(--c-text-secondary)]">描述</label>
        <textarea v-model="form.description" class="w-full rounded-xl border border-[var(--c-border-input)] bg-[var(--c-bg-input)] px-3 py-2 text-sm min-h-[72px]"></textarea>
      </div>
      <div class="flex justify-end gap-2">
        <button class="rounded-xl border border-red-200 bg-[var(--c-error-bg)] px-3 py-2 text-xs font-semibold text-[var(--c-error)]" :disabled="isDeleting" @click="remove">
          {{ isDeleting ? '删除中...' : '删除节点' }}
        </button>
        <button class="rounded-xl bg-[var(--c-accent)] px-3 py-2 text-xs font-semibold text-white" :disabled="isSaving || !form.label.trim()" @click="save">
          {{ isSaving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>

    <!-- 关联论文 -->
    <div class="rounded-2xl border border-[var(--c-border-light)] bg-[var(--c-bg-secondary)] p-4 space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-bold">关联论文 <span class="text-xs font-normal text-[var(--c-text-secondary)]">({{ linkedPapers.length }})</span></p>
        <button class="rounded-lg border border-[var(--c-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--c-bg-hover)]" @click="showAddPaper = !showAddPaper">
          {{ showAddPaper ? '取消' : '+ 添加' }}
        </button>
      </div>

      <!-- 添加论文搜索 -->
      <div v-if="showAddPaper" class="space-y-2">
        <input v-model="paperSearch" type="text" class="w-full rounded-xl border border-[var(--c-border-input)] bg-[var(--c-bg-input)] px-3 py-2 text-xs" placeholder="搜索文献库中的论文..." />
        <div class="max-h-40 overflow-y-auto space-y-1">
          <button
            v-for="doc in availablePapers"
            :key="doc.id"
            class="w-full rounded-xl border border-[var(--c-border-light)] bg-[var(--c-bg-primary)] px-3 py-2 text-left text-xs hover:bg-[var(--c-accent-bg)] transition-colors truncate"
            @click="addPaper(doc.id)"
          >
            {{ doc.name }}
          </button>
          <p v-if="availablePapers.length === 0" class="text-xs text-[var(--c-text-secondary)] text-center py-2">无匹配文献</p>
        </div>
      </div>

      <!-- 已关联论文列表 -->
      <div v-if="linkedPapers.length" class="space-y-1">
        <div
          v-for="paper in linkedPapers"
          :key="paper.id"
          class="group flex items-center gap-2 rounded-xl border border-[var(--c-border-light)] bg-[var(--c-bg-primary)] px-3 py-2"
          @contextmenu.prevent="emit('paper-contextmenu', paper.id, $event)"
        >
          <svg class="w-4 h-4 text-[var(--c-text-secondary)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <button class="flex-1 min-w-0 text-xs text-left truncate hover:text-[var(--c-accent)] transition-colors" @click="emit('open-paper', paper.id)">
            {{ paper.name }}
          </button>
          <button class="rounded-lg p-1 text-[var(--c-text-secondary)] hover:text-[var(--c-error)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" @click="removePaper(paper.id)">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <p v-else-if="!showAddPaper" class="text-xs text-[var(--c-text-secondary)]">暂无关联论文</p>
    </div>

    <!-- 关联笔记 -->
    <div class="rounded-2xl border border-[var(--c-border-light)] bg-[var(--c-bg-secondary)] p-4 space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-bold">关联笔记 <span class="text-xs font-normal text-[var(--c-text-secondary)]">({{ node.linked_note_ids?.length ?? 0 }})</span></p>
        <button class="rounded-lg border border-[var(--c-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--c-bg-hover)]" @click="showAddNote = !showAddNote">
          {{ showAddNote ? '取消' : '+ 添加' }}
        </button>
      </div>

      <div v-if="showAddNote" class="flex gap-2">
        <input v-model="noteIdInput" type="number" class="flex-1 rounded-xl border border-[var(--c-border-input)] bg-[var(--c-bg-input)] px-3 py-2 text-xs" placeholder="输入笔记 ID" @keyup.enter="addNote" />
        <button class="rounded-xl bg-[var(--c-accent)] px-3 py-2 text-xs font-semibold text-white" @click="addNote">添加</button>
      </div>

      <div v-if="node.linked_note_ids?.length" class="space-y-1">
        <div
          v-for="noteId in node.linked_note_ids"
          :key="noteId"
          class="group flex items-center gap-2 rounded-xl border border-[var(--c-border-light)] bg-[var(--c-bg-primary)] px-3 py-2"
        >
          <svg class="w-4 h-4 text-[var(--c-text-secondary)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <span class="flex-1 text-xs">笔记 #{{ noteId }}</span>
          <button class="rounded-lg p-1 text-[var(--c-text-secondary)] hover:text-[var(--c-error)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" @click="removeNote(noteId)">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <p v-else-if="!showAddNote" class="text-xs text-[var(--c-text-secondary)]">暂无关联笔记</p>
    </div>

  </div>
</template>
