<script setup lang="ts">
import { ref } from "vue"
import type { LocalChatMessageDto, LocalChatThreadDto } from "@readmeclaw/shared-ui"

const props = defineProps<{
  thread: LocalChatThreadDto | null
  messages: LocalChatMessageDto[]
}>()

const emit = defineEmits<{
  send: [message: string]
}>()

const draft = ref("")

function submit() {
  const message = draft.value.trim()
  if (!message || !props.thread) return
  emit("send", message)
  draft.value = ""
}
</script>

<template>
  <aside class="chat-panel">
    <header class="chat-panel__header">
      <div class="panel__eyebrow">Agent</div>
      <h2 class="panel__title">{{ thread?.title ?? "Local Thread" }}</h2>
    </header>

    <div class="chat-panel__messages">
      <div
        v-for="message in messages"
        :key="message.id"
        class="chat-message"
        :class="`chat-message--${message.role}`"
      >
        <strong>{{ message.role === "assistant" ? "AI" : "You" }}</strong>
        <p>{{ message.content }}</p>
      </div>
    </div>

    <div class="chat-panel__composer">
      <textarea
        v-model="draft"
        class="chat-panel__input"
        rows="4"
        placeholder="Ask the local runtime to search, bind, or summarize..."
      ></textarea>
      <button class="chat-panel__send" :disabled="!thread" @click="submit">Send</button>
    </div>
  </aside>
</template>
