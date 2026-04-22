<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { ChatMode } from '../../api'
import type { CustomModel } from '../../types'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'

const props = defineProps<{
  isLoadingContent: boolean
  chatMode: ChatMode
  customModels: CustomModel[]
  selectedModel: string
  selectedText?: string
  selectionMode?: boolean
  hasQueuedMessage?: boolean
}>()

const emit = defineEmits<{
  (e: 'send', payload: { text: string; mode: ChatMode; model: string; images?: string[]; contextText?: string }): void
  (e: 'stop'): void
  (e: 'enqueue', payload: { text: string; mode: ChatMode; model: string; images?: string[]; contextText?: string }): void
  (e: 'change-model', model: string): void
  (e: 'clear-selection'): void
  (e: 'open-model-modal'): void
  (e: 'delete-model', id: string): void
  (e: 'toggle-mode'): void
  (e: 'toggle-selection-mode'): void
}>()

const inputMessage = ref('')
const inputAreaRef = ref<HTMLElement | null>(null)
const { renderMarkdown } = useMarkdownRenderer()
const showPreview = ref(false)

// --- Menu States ---
const showPromptMenu = ref(false)
const showModelMenu = ref(false)
const showAtMenu = ref(false)
const showKeywordSubmenu = ref(false)
const isEditingPrompts = ref(false)

// --- File Attachment State ---
const fileInput = ref<HTMLInputElement | null>(null)
const attachedFiles = ref<{ name: string; id: string }[]>([])

// --- Pasted Image State ---
const pastedImages = ref<{ id: string; base64: string; thumbnail: string }[]>([])

// --- Reference State ---
const selectedReferences = ref<{ type: string; label: string; id: string }[]>([])

// --- Mock Keyword Indexes ---
const keywordIndexes = [
  { id: 'kw1', label: 'Chain-of-Thought' },
  { id: 'kw2', label: 'Unlearning' },
  { id: 'kw3', label: 'Fast-slow-VLA' },
]

// --- Prompt State ---
const defaultPrompts = [
  '这篇文章针对的问题的是什么？',
  '这篇论文有什么创新点？',
  '这篇论文有什么局限性或不足？',
  '这篇论文主要的研究方法是什么？',
  '这篇文章启发了哪些后续的研究？',
]
const userPrompts = ref<{ id: string; text: string }[]>(
  defaultPrompts.map((p, i) => ({ id: `sys_${i}`, text: p }))
)

// --- Computed ---
const hasInput = computed(() => inputMessage.value.trim().length > 0 || pastedImages.value.length > 0)

// --- Methods ---

const buildPayload = (message?: string) => {
  const content = message || inputMessage.value.trim()
  const images = pastedImages.value.length > 0
    ? pastedImages.value.map(img => img.base64)
    : undefined
  const contextText = props.selectedText?.trim() || undefined
  return { text: content || '', mode: props.chatMode, model: props.selectedModel, images, contextText }
}

const sendMessage = (message?: string) => {
  const content = message || inputMessage.value.trim()
  if (!content && pastedImages.value.length === 0) return
  if (props.isLoadingContent) return
  emit('send', buildPayload(message))
  if (!message) inputMessage.value = ''
  pastedImages.value = []
  closeMenus()
}

const enqueueMessage = () => {
  const content = inputMessage.value.trim()
  if (!content && pastedImages.value.length === 0) return
  if (!props.isLoadingContent) return
  emit('enqueue', buildPayload())
  inputMessage.value = ''
  pastedImages.value = []
  closeMenus()
}

// Paste image handler
const handlePaste = (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]
        if (!base64) return
        const dataUrl = reader.result as string
        pastedImages.value.push({
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          base64,
          thumbnail: dataUrl
        })
      }
      reader.readAsDataURL(file)
    }
  }
}

const removePastedImage = (id: string) => {
  pastedImages.value = pastedImages.value.filter(img => img.id !== id)
}

const closeOtherMenus = (active: 'at' | 'model' | 'prompt') => {
  if (active !== 'at') { showAtMenu.value = false; showKeywordSubmenu.value = false }
  if (active !== 'model') showModelMenu.value = false
  if (active !== 'prompt') { showPromptMenu.value = false; isEditingPrompts.value = false }
}

const closeMenus = () => {
  showAtMenu.value = false
  showKeywordSubmenu.value = false
  showModelMenu.value = false
  showPromptMenu.value = false
  isEditingPrompts.value = false
}

// @ Menu
const toggleAtMenu = () => {
  showAtMenu.value = !showAtMenu.value
  if (!showAtMenu.value) showKeywordSubmenu.value = false
  closeOtherMenus('at')
}
const handleKeywordClick = () => {
  showKeywordSubmenu.value = !showKeywordSubmenu.value
}
const selectFrameMode = () => {
  console.log('Frame selection mode activated')
  closeMenus()
}
const selectKeywordIndex = (kw: { id: string; label: string }) => {
  if (!selectedReferences.value.find(r => r.id === kw.id)) {
    selectedReferences.value.push({ type: 'keyword', label: kw.label, id: kw.id })
  }
  closeMenus()
}
const removeReference = (id: string) => {
  selectedReferences.value = selectedReferences.value.filter(r => r.id !== id)
}

// File Attachment
const triggerFileInput = () => {
  fileInput.value?.click()
}
const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files) {
    for (const file of target.files) {
      attachedFiles.value.push({ name: file.name, id: Date.now().toString() + file.name })
    }
  }
  target.value = ''
}
const removeFile = (id: string) => {
  attachedFiles.value = attachedFiles.value.filter(f => f.id !== id)
}

// Prompt Menu
const togglePromptMenu = () => {
  showPromptMenu.value = !showPromptMenu.value
  if (showPromptMenu.value) isEditingPrompts.value = false
  closeOtherMenus('prompt')
}
const handlePromptClick = (promptText: string) => {
  inputMessage.value = promptText
  showPromptMenu.value = false
}
const toggleEditPrompts = () => {
  isEditingPrompts.value = !isEditingPrompts.value
}
const addNewPrompt = () => {
  userPrompts.value.push({ id: `new_${Date.now()}`, text: '' })
}
const removePrompt = (index: number) => {
  userPrompts.value.splice(index, 1)
}
const savePrompts = () => {
  userPrompts.value = userPrompts.value.filter(p => p.text.trim() !== '')
  isEditingPrompts.value = false
}

// Model Menu
const toggleModelMenu = () => {
  showModelMenu.value = !showModelMenu.value
  closeOtherMenus('model')
}
const selectModel = (modelName: string) => {
  emit('change-model', modelName)
  showModelMenu.value = false
}
const deleteCustomModel = (id: string, event: Event) => {
  event.stopPropagation()
  if (confirm('确定删除该自定义模型？')) {
    emit('delete-model', id)
  }
}

// Global click to close menus
const handleGlobalClick = (e: MouseEvent) => {
  if (inputAreaRef.value && !inputAreaRef.value.contains(e.target as Node)) {
    closeMenus()
  }
}
onMounted(() => document.addEventListener('click', handleGlobalClick))
onBeforeUnmount(() => document.removeEventListener('click', handleGlobalClick))
</script>

<template>
  <div ref="inputAreaRef" class="chat-input-area p-4 backdrop-blur-sm">

    <!-- Preview blocks (Selections + References + Files + Images) -->
    <div v-if="selectedText || selectedReferences.length > 0 || attachedFiles.length > 0 || pastedImages.length > 0" class="flex flex-wrap gap-2 mb-2.5">

      <!-- PDF Selection Preview -->
      <div v-if="selectedText" class="chat-chip chat-chip--selection">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>
        <span class="max-w-20 truncate" :title="selectedText">{{ selectedText }}</span>
        <button @click="$emit('clear-selection')" class="chat-chip__remove">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <!-- Reference Tags -->
      <div v-for="ref in selectedReferences" :key="ref.id" class="chat-chip chat-chip--reference">
        <span class="chat-chip__at">@</span>
        <span class="max-w-20 truncate">{{ ref.label }}</span>
        <button @click="removeReference(ref.id)" class="chat-chip__remove">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <!-- File Tags -->
      <div v-for="file in attachedFiles" :key="file.id" class="chat-chip chat-chip--file">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
        <span class="max-w-20 truncate">{{ file.name }}</span>
        <button @click="removeFile(file.id)" class="chat-chip__remove">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <!-- Pasted Image Previews -->
      <div v-for="img in pastedImages" :key="img.id" class="relative group">
        <img :src="img.thumbnail" class="h-12 w-12 object-cover rounded chat-image-thumb" />
        <button
          @click="removePastedImage(img.id)"
          class="chat-image-remove"
        >
          <svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>

    <!-- Toolbar row -->
    <div class="flex items-center gap-2 mb-1.5">

      <!-- Prompts Menu -->
      <div class="relative">
        <button
          @click="togglePromptMenu"
          class="chat-toolbar-btn chat-toolbar-btn--combo interactive-3d"
          :class="{ 'is-active': showPromptMenu }"
          title="预设提示词"
        >
          <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          <svg class="w-3 h-3 chat-toolbar-caret" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </button>

        <!-- Prompt Dropdown -->
        <div v-if="showPromptMenu" class="chat-menu chat-menu--prompt">
          <div class="chat-menu__header">
            <span class="chat-menu__title">提示词</span>
            <div class="flex gap-1">
              <button v-if="isEditingPrompts" @click="addNewPrompt" class="chat-menu-icon-btn chat-menu-icon-btn--accent" title="新增提示词">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
              </button>
              <button @click="isEditingPrompts ? savePrompts() : toggleEditPrompts()" class="chat-menu-icon-btn" :title="isEditingPrompts ? '保存' : '编辑'">
                <svg v-if="isEditingPrompts" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
            </div>
          </div>
          <div class="max-h-60 overflow-y-auto">
            <div v-if="isEditingPrompts" class="px-2 space-y-1">
              <div v-for="(prompt, index) in userPrompts" :key="prompt.id" class="flex items-center gap-1">
                <input v-model="prompt.text" type="text" class="chat-menu-input" placeholder="输入提示词..." />
                <button @click="removePrompt(index)" class="chat-menu-icon-btn chat-menu-icon-btn--danger">
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div v-else>
              <button
                v-for="prompt in userPrompts"
                :key="prompt.id"
                @click="handlePromptClick(prompt.text)"
                class="chat-menu-item chat-menu-item--prompt truncate"
                :title="prompt.text"
              >
                {{ prompt.text }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- @ Button -->
      <div class="relative">
        <button
          @click="toggleAtMenu"
          class="chat-toolbar-btn chat-toolbar-btn--at interactive-3d"
          :class="{ 'is-active': showAtMenu }"
          title="插入引用"
        >@</button>
        <div v-if="showAtMenu" class="chat-menu chat-menu--dark">
          <div class="relative">
            <button @click="handleKeywordClick" class="chat-menu-item chat-menu-item--inverse flex items-center justify-between">
              <span>本文关键词</span>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
            </button>
            <div v-if="showKeywordSubmenu" class="chat-menu chat-menu--dark chat-menu--sub">
              <button @click="selectFrameMode" class="chat-menu-item chat-menu-item--inverse">框选模式</button>
              <div class="chat-menu-divider"></div>
              <div class="chat-menu-label">已建立索引</div>
              <button v-for="kw in keywordIndexes" :key="kw.id" @click="selectKeywordIndex(kw)" class="chat-menu-item chat-menu-item--inverse">{{ kw.label }}</button>
            </div>
          </div>
          <button class="chat-menu-item chat-menu-item--disabled">已读论文</button>
        </div>
      </div>

      <!-- Attachment Button -->
      <button
        @click="triggerFileInput"
        class="chat-toolbar-btn interactive-3d"
        :class="{ 'is-active': attachedFiles.length > 0 || pastedImages.length > 0 }"
        title="添加文件"
      >
        <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
      </button>
      <input ref="fileInput" type="file" multiple class="hidden" @change="handleFileSelect" />

      <!-- Chat Mode Toggle Button -->
      <button
        @click="$emit('toggle-mode')"
        class="chat-toolbar-btn interactive-3d"
        :title="chatMode === 'agent' ? '当前: Agent 模式 (点击切换到 Chat)' : '当前: Chat 模式 (点击切换到 Agent)'"
      >
        <!-- Agent mode icon: magnifier -->
        <svg v-if="chatMode === 'agent'" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <!-- Chat mode icon: chat bubble -->
        <svg v-else class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>

      <!-- Selection Mode Toggle Button -->
      <button
        @click="$emit('toggle-selection-mode')"
        class="chat-toolbar-btn interactive-3d"
        :class="{ 'is-active': selectionMode }"
        title="选择模式"
      >
        <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
      </button>

      <!-- Model Selector -->
      <div class="relative ml-auto">
        <button
          @click="toggleModelMenu"
          class="chat-model-btn interactive-3d"
          :class="{ 'is-active': showModelMenu }"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          <span class="max-w-24 truncate">{{ selectedModel }}</span>
          <svg class="w-2.5 h-2.5 transition-transform" :class="{ 'rotate-180': showModelMenu }" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </button>

        <div v-if="showModelMenu" class="chat-menu chat-menu--model animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button
            @click="selectModel('README Fusion')"
            class="chat-menu-item chat-menu-item--model"
            :class="{ 'is-selected': selectedModel === 'README Fusion' }"
          >README Fusion</button>

          <template v-if="customModels.length > 0">
            <div v-for="model in customModels" :key="model.id" class="relative group chat-menu-row">
              <button
                @click="selectModel(model.name)"
                class="chat-menu-item chat-menu-item--model chat-menu-item--model-entry truncate"
                :class="{ 'is-selected': selectedModel === model.name }"
              >{{ model.name }}</button>
              <button
                @click="deleteCustomModel(model.id, $event)"
                class="chat-model-delete-btn"
              >
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </template>

          <button
            @click="$emit('open-model-modal'); showModelMenu = false"
            class="chat-menu-item chat-menu-item--model chat-menu-item--add-model"
          >+ 添加自定义模型</button>
        </div>
      </div>
    </div>

    <div class="flex gap-2.5 items-end">
      <div class="chat-composer flex-1 flex flex-col overflow-hidden">
        <!-- Markdown Preview Overlay -->
        <div v-if="showPreview && inputMessage.trim()" class="chat-preview-panel">
          <div class="chat-preview-header">
            <span>预览</span>
            <button @click="showPreview = false" class="chat-preview-close">关闭</button>
          </div>
          <div class="markdown-body prose prose-sm max-w-none dark:prose-invert" v-html="renderMarkdown(inputMessage)"></div>
        </div>

        <div class="flex items-center px-1">
          <textarea
            v-model="inputMessage"
            placeholder="输入问题... (可粘贴图片)"
            @keydown.enter.exact.prevent="isLoadingContent ? enqueueMessage() : sendMessage()"
            @paste="handlePaste"
            class="chat-textarea w-full px-2 py-2 resize-none leading-relaxed"
            style="field-sizing: content; min-height: 38px; max-height: 160px; overflow-y: auto !important;"
          ></textarea>

          <!-- Preview Toggle Button -->
          <button
            v-if="inputMessage.trim()"
            @click="showPreview = !showPreview"
            class="chat-preview-toggle"
            :title="showPreview ? '隐藏预览' : '显示渲染预览'"
          >
            <svg class="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Action Buttons: Stop / Queue / Send -->
      <div class="flex items-center gap-1.5 self-end flex-shrink-0">
        <!-- Queue button: visible when loading AND has input -->
        <button
          v-if="isLoadingContent && hasInput"
          @click="enqueueMessage()"
          class="chat-queue-btn interactive-3d flex items-center justify-center"
          :class="hasQueuedMessage ? 'chat-queue-btn--queued' : ''"
          :title="hasQueuedMessage ? '已有排队消息，将替换' : '排队发送（等AI回复后自动发送）'"
        >
          <svg class="w-[16px] h-[16px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2" />
            <circle cx="12" cy="12" r="10" stroke-width="2" fill="none" />
          </svg>
        </button>

        <!-- Stop button: visible when loading -->
        <button
          v-if="isLoadingContent"
          @click="$emit('stop')"
          class="chat-stop-btn interactive-3d flex items-center justify-center"
          title="停止生成并撤销本次对话"
        >
          <svg class="w-[14px] h-[14px]" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        </button>

        <!-- Send button: visible when NOT loading -->
        <button
          v-else
          @click="sendMessage()"
          :disabled="!hasInput"
          class="chat-send-btn interactive-3d flex items-center justify-center"
          :class="hasInput ? 'chat-send-btn--active' : 'chat-send-btn--disabled'"
        >
          <svg class="w-[18px] h-[18px] chat-send-btn__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-input-area {
  border-top: var(--border-width) solid var(--c-border-light);
  background: var(--c-bg-elevated);
}

.chat-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  border: var(--border-width) solid transparent;
  font-size: var(--text-xs);
  color: var(--c-text-secondary);
}

.chat-chip--selection {
  background: var(--c-accent-bg);
  border-color: var(--c-accent-border);
  color: var(--c-accent);
}

.chat-chip--reference {
  background: var(--c-bg-secondary);
  border-color: var(--c-border);
}

.chat-chip--file {
  background: var(--c-bg-tertiary);
  border-color: var(--c-border);
}

.chat-chip__at {
  color: var(--c-accent-light);
  font-weight: var(--font-bold);
}

.chat-chip__remove {
  color: var(--c-text-tertiary);
  transition: color var(--duration-fast) var(--ease-default);
}

.chat-chip__remove:hover {
  color: var(--c-text-primary);
}

.chat-image-thumb {
  border: var(--border-width) solid var(--c-border-input);
}

.chat-image-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  border: var(--border-width) solid var(--c-accent-gradient-border);
  background: linear-gradient(135deg, var(--c-accent-gradient-start), var(--c-accent-gradient-end));
  color: var(--c-text-on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-default);
}

.group:hover .chat-image-remove {
  opacity: 1;
}

.chat-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--btn-height-md);
  min-height: var(--btn-height-md);
  border-radius: var(--btn-radius);
  border: var(--border-width) solid transparent;
  color: var(--c-btn-text);
  background: transparent;
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default),
              box-shadow var(--duration-fast) var(--ease-default),
              transform var(--duration-fast) var(--ease-default);
}

.chat-toolbar-btn:hover {
  background: var(--c-btn-bg-hover);
  color: var(--c-btn-text-hover);
  border-color: var(--c-btn-border-hover);
}

.chat-toolbar-btn.is-active {
  background: var(--c-btn-icon-active-bg);
  color: var(--c-btn-icon-active-text);
  border-color: var(--c-btn-icon-active-border);
  box-shadow: var(--shadow-btn-icon-active);
}

.chat-toolbar-btn--combo {
  gap: var(--space-1);
  padding: 0 var(--btn-padding-x);
}

.chat-toolbar-btn--at {
  font-size: var(--btn-font-size);
  font-weight: var(--font-bold);
}

.chat-toolbar-caret {
  color: var(--c-text-muted);
}

.chat-toolbar-btn.is-active .chat-toolbar-caret {
  color: var(--c-btn-icon-active-text);
}

.chat-toolbar-btn > svg,
.chat-model-btn > svg,
.chat-preview-toggle > svg,
.chat-send-btn__icon {
  width: var(--btn-icon-size);
  height: var(--btn-icon-size);
}

.chat-model-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--btn-height-md);
  border-radius: var(--btn-radius);
  border: var(--border-width) solid transparent;
  padding: 0 var(--btn-padding-x);
  color: var(--c-btn-text);
  font-size: var(--btn-font-size);
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default);
}

.chat-model-btn:hover {
  background: var(--c-btn-bg-hover);
  color: var(--c-btn-text-hover);
  border-color: var(--c-btn-border-hover);
}

.chat-model-btn.is-active {
  background: var(--c-btn-icon-active-bg);
  color: var(--c-btn-icon-active-text);
  border-color: var(--c-btn-icon-active-border);
  box-shadow: var(--shadow-btn-icon-active);
}

.chat-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: var(--space-1);
  border-radius: var(--radius-lg);
  border: var(--border-width) solid var(--c-border);
  background: var(--c-bg-primary);
  box-shadow: var(--shadow-lg);
  z-index: var(--z-dropdown);
}

.chat-menu--prompt {
  min-width: 256px;
  max-width: 360px;
  padding: var(--space-2) 0;
}

.chat-menu--model {
  right: 0;
  left: auto;
  min-width: 168px;
  overflow: hidden;
}

.chat-menu--dark {
  min-width: 150px;
  padding: var(--space-1) 0;
  border-color: var(--c-accent-gradient-border);
  background: linear-gradient(145deg, var(--c-accent), var(--c-accent-hover));
  color: var(--c-text-on-accent);
}

.chat-menu--sub {
  top: 0;
  left: 100%;
  margin-left: var(--space-1);
  margin-bottom: 0;
  min-width: 136px;
}

.chat-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-3) var(--space-2);
  margin-bottom: var(--space-1);
  border-bottom: var(--border-width) solid var(--c-border-light);
}

.chat-menu__title {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--c-text-tertiary);
}

.chat-menu-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  color: var(--c-text-tertiary);
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default);
}

.chat-menu-icon-btn:hover {
  background: var(--c-bg-hover);
  color: var(--c-text-primary);
}

.chat-menu-icon-btn--accent {
  color: var(--c-accent);
}

.chat-menu-icon-btn--danger:hover {
  color: var(--c-error);
}

.chat-menu-input {
  flex: 1;
  border: var(--border-width) solid var(--c-border-input);
  border-radius: var(--radius-md);
  background: var(--c-bg-input);
  color: var(--c-text-primary);
  font-size: var(--text-xs);
  padding: var(--space-1-5) var(--space-2);
  transition: border-color var(--duration-fast) var(--ease-default),
              box-shadow var(--duration-fast) var(--ease-default);
}

.chat-menu-input:focus {
  outline: none;
  border-color: var(--c-border-focus);
  box-shadow: var(--ring-focus);
}

.chat-menu-item {
  width: 100%;
  text-align: left;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--c-text-secondary);
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default);
}

.chat-menu-item:hover {
  background: var(--c-bg-hover);
  color: var(--c-text-primary);
}

.chat-menu-item--prompt {
  padding-left: var(--space-4);
  padding-right: var(--space-4);
}

.chat-menu-item--inverse {
  color: var(--c-on-accent-high);
}

.chat-menu-item--inverse:hover {
  background: var(--c-on-accent-hover-bg);
  color: var(--c-text-on-accent);
}

.chat-menu-item--disabled {
  color: var(--c-on-accent-disabled);
  cursor: not-allowed;
}

.chat-menu-item--disabled:hover {
  background: transparent;
  color: var(--c-on-accent-disabled);
}

.chat-menu-label {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  color: var(--c-on-accent-muted);
}

.chat-menu-divider {
  height: var(--border-width);
  margin: var(--space-1) 0;
  background: var(--c-on-accent-divider);
}

.chat-menu-row {
  border-top: var(--border-width) solid var(--c-border-light);
}

.chat-menu-item--model {
  font-size: var(--text-xs);
}

.chat-menu-item--model.is-selected {
  background: var(--c-accent-bg);
  color: var(--c-accent);
}

.chat-menu-item--model-entry {
  padding-right: var(--space-8);
}

.chat-menu-item--add-model {
  border-top: var(--border-width) solid var(--c-border-light);
  color: var(--c-text-tertiary);
}

.chat-model-delete-btn {
  position: absolute;
  right: var(--space-2);
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--c-text-muted);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default),
              background-color var(--duration-fast) var(--ease-default);
}

.chat-menu-row:hover .chat-model-delete-btn {
  opacity: 1;
}

.chat-model-delete-btn:hover {
  color: var(--c-error);
  background: var(--c-error-bg);
}

.chat-composer {
  border: var(--border-width) solid var(--c-border-input);
  border-radius: var(--radius-xl);
  background: var(--c-bg-primary);
  transition: border-color var(--duration-fast) var(--ease-default),
              box-shadow var(--duration-fast) var(--ease-default);
}

.chat-composer:focus-within {
  border-color: var(--c-border-focus);
  box-shadow: var(--ring-focus);
}

.chat-preview-panel {
  max-height: 160px;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3);
  border-bottom: var(--border-width) solid var(--c-border-light);
  background: var(--c-bg-secondary);
}

.chat-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-1);
  font-size: var(--text-2xs);
  font-weight: var(--font-bold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c-text-muted);
}

.chat-preview-close {
  color: var(--c-text-muted);
  transition: color var(--duration-fast) var(--ease-default);
}

.chat-preview-close:hover {
  color: var(--c-error);
}

.chat-textarea {
  border: none;
  background: transparent;
  color: var(--c-text-primary);
  font-size: var(--text-base);
}

.chat-textarea::placeholder {
  color: var(--c-text-placeholder);
}

.chat-textarea:focus {
  outline: none;
  box-shadow: none;
}

.chat-preview-toggle {
  margin-right: var(--space-1);
  padding: var(--space-1-5);
  border-radius: var(--radius-md);
  color: var(--c-text-muted);
  transition: color var(--duration-fast) var(--ease-default),
              background-color var(--duration-fast) var(--ease-default);
}

.chat-preview-toggle:hover {
  color: var(--c-accent);
  background: var(--c-accent-bg);
}

.chat-send-btn {
  width: var(--btn-height-lg);
  height: var(--btn-height-lg);
  border-radius: var(--btn-radius);
  border: var(--border-width) solid var(--c-border-input);
  background: var(--c-bg-primary);
  color: var(--c-accent);
  box-shadow: var(--interactive-shadow-rest);
  transition: background-color var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default),
              box-shadow var(--duration-fast) var(--ease-default),
              transform var(--duration-fast) var(--ease-default);
}

.chat-send-btn--active {
  background: var(--c-btn-icon-active-bg);
  border-color: var(--c-btn-icon-active-border);
  color: var(--c-btn-icon-active-text);
  box-shadow: var(--shadow-btn-icon-active);
}

.chat-send-btn--active:hover {
  background: var(--c-btn-bg-active);
  border-color: var(--c-btn-icon-active-border);
  color: var(--c-btn-icon-active-text);
  box-shadow: var(--shadow-btn-icon-active);
}

.chat-send-btn--disabled {
  background: var(--c-bg-secondary);
  border-color: var(--c-border);
  color: var(--c-text-muted);
  cursor: not-allowed;
}

.chat-send-btn__icon {
  color: var(--c-accent);
}

.chat-send-btn--disabled .chat-send-btn__icon {
  color: var(--c-text-muted);
}

/* ---- Stop Button ---- */
.chat-stop-btn {
  width: var(--btn-height-lg);
  height: var(--btn-height-lg);
  border-radius: var(--btn-radius);
  border: var(--border-width) solid var(--c-border-input);
  background: var(--c-bg-primary);
  color: var(--c-text-secondary);
  box-shadow: var(--interactive-shadow-rest);
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default),
              box-shadow var(--duration-fast) var(--ease-default),
              transform var(--duration-fast) var(--ease-default);
}

.chat-stop-btn:hover {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  border-color: var(--c-accent);
  box-shadow: var(--shadow-btn-icon-active);
}

/* ---- Queue Button ---- */
.chat-queue-btn {
  width: var(--btn-height-md);
  height: var(--btn-height-md);
  border-radius: var(--btn-radius);
  border: var(--border-width) solid var(--c-accent-border);
  background: var(--c-accent-bg);
  color: var(--c-accent);
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default),
              transform var(--duration-fast) var(--ease-default);
}

.chat-queue-btn:hover {
  background: var(--c-btn-bg-active);
  color: var(--c-accent-hover);
  border-color: var(--c-accent);
}

.chat-queue-btn--queued {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  border-color: var(--c-accent);
}

.chat-queue-btn--queued:hover {
  background: var(--c-accent-hover);
  color: var(--c-text-on-accent);
}
</style>
