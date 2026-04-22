<script setup lang="ts">
const props = withDefaults(defineProps<{
  eyebrow?: string
  title: string
  description: string
  primaryLabel?: string
  secondaryLabel?: string
  compact?: boolean
}>(), {
  eyebrow: 'Workspace',
  primaryLabel: undefined,
  secondaryLabel: undefined,
  compact: false,
})

const emit = defineEmits<{
  primary: []
  secondary: []
}>()
</script>

<template>
  <section class="empty-state" :class="{ 'empty-state--compact': props.compact }">
    <div class="empty-state__eyebrow">{{ props.eyebrow }}</div>
    <h2 class="empty-state__title">{{ props.title }}</h2>
    <p class="empty-state__description">{{ props.description }}</p>
    <div v-if="props.primaryLabel || props.secondaryLabel" class="empty-state__actions">
      <button
        v-if="props.primaryLabel"
        class="empty-state__action empty-state__action--primary"
        @click="emit('primary')"
      >
        {{ props.primaryLabel }}
      </button>
      <button
        v-if="props.secondaryLabel"
        class="empty-state__action"
        @click="emit('secondary')"
      >
        {{ props.secondaryLabel }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 100%;
  padding: 28px;
  text-align: center;
  color: var(--c-text-secondary);
}

.empty-state--compact {
  min-height: auto;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 18px;
  text-align: left;
}

.empty-state__eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c-text-muted);
}

.empty-state__title {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
  color: var(--c-text-primary);
}

.empty-state--compact .empty-state__title {
  font-size: 15px;
}

.empty-state__description {
  max-width: 420px;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-secondary);
}

.empty-state--compact .empty-state__description {
  max-width: none;
  font-size: 12px;
}

.empty-state__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 6px;
}

.empty-state--compact .empty-state__actions {
  justify-content: flex-start;
}

.empty-state__action {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  border: var(--border-width) solid var(--c-border-input);
  background: var(--c-bg-elevated);
  color: var(--c-text-primary);
  font-size: 12px;
  font-weight: 600;
}

.empty-state__action--primary {
  border-color: var(--c-accent-border);
  background: var(--c-accent-bg);
  color: var(--c-accent);
}
</style>
