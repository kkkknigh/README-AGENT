<script setup lang="ts">
import { computed, ref } from 'vue'
import { RELATION_TYPES, getRelationDef } from './relationTypes'

const model = defineModel<string>({ default: '' })

const showExpanded = ref(false)
const customMode = ref(false)
const customInput = ref('')

const pinnedTypes = RELATION_TYPES.filter(t => t.tier === 'pinned')
const primaryTypes = RELATION_TYPES.filter(t => t.tier === 'primary')
const expandedTypes = RELATION_TYPES.filter(t => t.tier === 'expanded')

const currentDef = computed(() => getRelationDef(model.value))

function select(value: string) {
  model.value = value
  customMode.value = false
  showExpanded.value = false
}

function enterCustom() {
  customMode.value = true
  customInput.value = model.value
}

function confirmCustom() {
  const v = customInput.value.trim()
  if (v) model.value = v
  customMode.value = false
}
</script>

<template>
  <div class="space-y-1.5">
    <!-- 自定义输入模式 -->
    <div v-if="customMode" class="flex gap-1.5">
      <input
        v-model="customInput"
        type="text"
        class="flex-1 rounded-lg border border-[var(--c-border-input)] bg-[var(--c-bg-input)] px-3 py-1.5 text-sm"
        placeholder="自定义关系类型"
        @keyup.enter="confirmCustom"
      />
      <button class="rounded-lg bg-[var(--c-accent)] px-2.5 py-1.5 text-xs font-semibold text-white" @click="confirmCustom">确定</button>
      <button class="rounded-lg border border-[var(--c-border-input)] px-2.5 py-1.5 text-xs" @click="customMode = false">取消</button>
    </div>

    <!-- 选择模式 -->
    <template v-else>
      <!-- 当前选中 -->
      <div class="flex items-center gap-1.5 text-xs text-[var(--c-text-secondary)]">
        <span class="inline-block w-2.5 h-2.5 rounded-full" :style="{ background: currentDef.color }"></span>
        <span class="font-semibold">{{ currentDef.label || currentDef.value || '未选择' }}</span>
      </div>

      <!-- pinned: parent_of -->
      <div class="flex flex-wrap gap-1">
        <button
          v-for="t in pinnedTypes" :key="t.value"
          class="rel-chip rel-chip--pinned"
          :class="{ 'rel-chip--active': model === t.value }"
          :style="{ '--chip-color': t.color } as any"
          @click="select(t.value)"
        >
          <span class="rel-dot" :style="{ background: t.color }"></span>
          {{ t.label }}
        </button>
      </div>

      <!-- primary -->
      <div class="flex flex-wrap gap-1">
        <button
          v-for="t in primaryTypes" :key="t.value"
          class="rel-chip"
          :class="{ 'rel-chip--active': model === t.value }"
          :style="{ '--chip-color': t.color } as any"
          @click="select(t.value)"
        >
          <span class="rel-dot" :style="{ background: t.color }"></span>
          {{ t.label }}
        </button>
      </div>

      <!-- expanded toggle + items -->
      <div>
        <button class="text-xs text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)]" @click="showExpanded = !showExpanded">
          {{ showExpanded ? '收起' : '更多关系类型' }}
        </button>
        <div v-if="showExpanded" class="mt-1 flex flex-wrap gap-1">
          <button
            v-for="t in expandedTypes" :key="t.value"
            class="rel-chip"
            :class="{ 'rel-chip--active': model === t.value }"
            :style="{ '--chip-color': t.color } as any"
            @click="select(t.value)"
          >
            <span class="rel-dot" :style="{ background: t.color }"></span>
            {{ t.label }}
          </button>
        </div>
      </div>

      <!-- 自定义 -->
      <button class="text-xs text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)]" @click="enterCustom">
        自定义…
      </button>
    </template>
  </div>
</template>

<style scoped>
.rel-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rel-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 9999px;
  border: 1px solid var(--c-border-light, #e5e7eb);
  background: transparent;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.rel-chip:hover {
  border-color: var(--chip-color);
  background: color-mix(in srgb, var(--chip-color) 8%, transparent);
}
.rel-chip--active {
  border-color: var(--chip-color);
  background: color-mix(in srgb, var(--chip-color) 15%, transparent);
  font-weight: 600;
}
.rel-chip--pinned {
  border-width: 2px;
}
</style>
