<script setup lang="ts">
import { reactive, watch } from "vue"

const props = defineProps<{
  baseUrl: string
  accessToken: string
  syncSummary: string
  modeLabel: string
}>()

const emit = defineEmits<{
  save: [payload: { baseUrl: string; accessToken: string }]
  sync: []
}>()

const form = reactive({
  baseUrl: props.baseUrl,
  accessToken: props.accessToken,
})

watch(
  () => [props.baseUrl, props.accessToken],
  ([baseUrl, accessToken]) => {
    form.baseUrl = baseUrl
    form.accessToken = accessToken
  }
)
</script>

<template>
  <section class="panel">
    <header class="panel__header">
      <div>
        <div class="panel__eyebrow">Remote</div>
        <h2 class="panel__title">Sync Bridge</h2>
      </div>
      <div class="panel__meta">{{ modeLabel }}</div>
    </header>

    <div class="settings-form">
      <label class="settings-form__field">
        <span>Remote Base URL</span>
        <input v-model="form.baseUrl" class="settings-form__input" placeholder="https://your-remote-api.example/api" />
      </label>

      <label class="settings-form__field">
        <span>Access Token</span>
        <input v-model="form.accessToken" class="settings-form__input" placeholder="Bearer token for bootstrap sync" />
      </label>

      <div class="settings-form__notice">{{ syncSummary }}</div>

      <div class="settings-form__actions">
        <button class="settings-form__button settings-form__button--muted" @click="emit('save', { baseUrl: form.baseUrl, accessToken: form.accessToken })">
          Save
        </button>
        <button class="settings-form__button" @click="emit('sync')">Sync Now</button>
      </div>
    </div>
  </section>
</template>
