<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  (e: 'save', model: { name: string; apiBase: string; apiKey: string }): void
  (e: 'close'): void
}>()

const newCustomModel = ref({ name: '', apiBase: '', apiKey: '' })
const formError = ref('')
const showApiKey = ref(false)

function saveCustomModel() {
  if (!newCustomModel.value.name || !newCustomModel.value.apiBase) {
    formError.value = '请填写模型名称和 API Base'
    return
  }

  formError.value = ''
  emit('save', { ...newCustomModel.value })
}
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]">
    <div class="popup-surface w-full max-w-md overflow-hidden">
      <div class="popup-header">
        <div>
          <div class="popup-title">自定义模型</div>
          <div class="popup-subtitle">Add a custom OpenAI-compatible model</div>
        </div>
        <button class="popup-icon-btn" @click="$emit('close')" title="关闭">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="popup-body space-y-3">
        <div>
          <label class="popup-label mb-1 block">模型名称 (Model ID)</label>
          <input
            v-model="newCustomModel.name"
            type="text"
            placeholder="e.g. deepseek-chat"
            class="popup-input"
          />
        </div>

        <div>
          <label class="popup-label mb-1 block">API Base URL</label>
          <input
            v-model="newCustomModel.apiBase"
            type="text"
            placeholder="https://api.example.com/v1"
            class="popup-input"
          />
        </div>

        <div>
          <label class="popup-label mb-1 block">API Key</label>
          <div class="relative">
            <input
              v-model="newCustomModel.apiKey"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="sk-..."
              class="popup-input !pr-10"
            />
            <button type="button" tabindex="-1" @click="showApiKey = !showApiKey" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg v-if="showApiKey" class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg v-else class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
          </div>
        </div>

        <p v-if="formError" class="popup-text-error">{{ formError }}</p>
      </div>

      <div class="flex justify-end gap-2 border-t border-black/5 px-3 py-3 dark:border-white/5">
        <button @click="$emit('close')" class="popup-button h-8 px-3">取消</button>
        <button @click="saveCustomModel" class="popup-button popup-button--accent h-8 px-4">保存模型</button>
      </div>
    </div>
  </div>
</template>
