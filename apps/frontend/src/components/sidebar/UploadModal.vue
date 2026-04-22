<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'file', file: File): void
  (e: 'link', url: string): void
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const importUrl = ref('')
const isDragOver = ref(false)

function onDropZoneClick() {
  fileInput.value?.click()
}

function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file && file.type === 'application/pdf') {
    emit('file', file)
  }
  target.value = ''
}

function onDrop(event: DragEvent) {
  isDragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file && file.type === 'application/pdf') {
    emit('file', file)
  }
}

function onDragOver() {
  isDragOver.value = true
}

function onDragLeave() {
  isDragOver.value = false
}

function submitLink() {
  const url = importUrl.value.trim()
  if (!url) return
  emit('link', url)
}
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
    @mousedown.self="$emit('close')"
  >
    <div class="popup-surface upload-modal-surface w-full max-w-md overflow-hidden" style="animation: pop-in var(--duration-slow) var(--ease-out);">
      <!-- Header -->
      <div class="popup-header upload-modal-header">
        <div class="upload-header-copy">
          <div class="popup-title">{{ t('sidebar.uploadModalTitle') }}</div>
          <div class="popup-subtitle">{{ t('sidebar.uploadModalSubtitle') }}</div>
        </div>
        <button class="popup-icon-btn" @click="$emit('close')" :title="t('sidebar.close')">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="popup-body upload-modal-body">
        <!-- Drop Zone -->
        <input
          ref="fileInput"
          type="file"
          accept=".pdf"
          class="hidden"
          @change="onFileSelected"
        />
        <div
          class="upload-dropzone"
          :class="{ 'upload-dropzone--active': isDragOver }"
          @click="onDropZoneClick"
          @drop.prevent="onDrop"
          @dragover.prevent="onDragOver"
          @dragleave.prevent="onDragLeave"
        >
          <!-- Plus icon -->
          <svg class="upload-dropzone-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4" />
          </svg>
          <span class="upload-dropzone-text">{{ t('sidebar.dropzoneText') }}</span>
          <span class="upload-dropzone-hint">{{ t('sidebar.dropzoneHint') }}</span>
        </div>

        <!-- Divider -->
        <div class="upload-divider">
          <span class="upload-divider-text">{{ t('sidebar.orDivider') }}</span>
        </div>

        <!-- URL Input -->
        <div class="upload-link-row flex items-center gap-2">
          <input
            id="import-url"
            name="import-url"
            v-model="importUrl"
            type="text"
            :placeholder="t('sidebar.importLinkPlaceholder')"
            class="popup-input flex-1"
            @keydown.enter="submitLink"
            @keydown.escape="$emit('close')"
          />
          <button
            @click="submitLink"
            :disabled="!importUrl.trim()"
            class="popup-button popup-button--accent h-[34px] px-3 shrink-0"
          >
            {{ t('sidebar.importAction') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-modal-surface {
  min-height: 320px;
}

.upload-modal-header {
  min-height: calc(var(--popup-header-height) + 20px);
}

.upload-header-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-modal-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 240px;
}

.upload-link-row {
  margin-top: auto;
  margin-bottom: auto;
}

.upload-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-8) var(--space-4);
  border: 2px dashed var(--c-border-input);
  border-radius: var(--popup-radius);
  background: var(--c-bg-secondary);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-default),
              background-color var(--duration-fast) var(--ease-default);
}

.upload-dropzone:hover {
  border-color: var(--c-accent-light);
  background: var(--c-accent-bg);
}

.upload-dropzone--active {
  border-color: var(--c-accent);
  border-style: solid;
  background: var(--c-accent-bg);
}

.upload-dropzone-icon {
  width: 32px;
  height: 32px;
  color: var(--c-text-muted);
  transition: color var(--duration-fast) var(--ease-default);
}

.upload-dropzone:hover .upload-dropzone-icon,
.upload-dropzone--active .upload-dropzone-icon {
  color: var(--c-accent);
}

.upload-dropzone-text {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--c-text-secondary);
}

.upload-dropzone-hint {
  font-size: var(--text-xs);
  color: var(--c-text-muted);
}

.upload-divider {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.upload-divider::before,
.upload-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--c-border);
}

.upload-divider-text {
  font-size: var(--text-xs);
  color: var(--c-text-muted);
  flex-shrink: 0;
}
</style>
