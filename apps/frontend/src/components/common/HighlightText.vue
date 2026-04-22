<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  text: string
  keyword: string
}>()

const segments = computed(() => {
  const q = props.keyword.trim()
  if (!q) return [{ text: props.text, match: false }]

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  const parts = props.text.split(re)

  return parts
    .filter((p) => p !== '')
    .map((p) => ({ text: p, match: p.toLowerCase() === q.toLowerCase() }))
})
</script>

<template>
  <template v-for="(seg, i) in segments" :key="i">
    <mark v-if="seg.match" class="hl-match">{{ seg.text }}</mark>
    <template v-else>{{ seg.text }}</template>
  </template>
</template>

<style scoped>
.hl-match {
  background: rgb(253 224 71 / 0.45);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
:global(.dark) .hl-match {
  background: rgb(234 179 8 / 0.3);
}
</style>
