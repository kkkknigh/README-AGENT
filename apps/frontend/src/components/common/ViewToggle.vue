<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const STORAGE_KEY = 'readme_library_view'

const props = defineProps<{
  active: 'library' | 'graph'
}>()

const router = useRouter()

onMounted(() => {
  localStorage.setItem(STORAGE_KEY, props.active)
})

const goLibrary = () => {
  localStorage.setItem(STORAGE_KEY, 'library')
  router.replace('/library')
}

const goGraph = () => {
  localStorage.setItem(STORAGE_KEY, 'graph')
  router.replace('/tag-graph')
}
</script>

<template>
  <div class="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 p-0.5">
    <button
      :class="[
        'px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200',
        active === 'library'
          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
      ]"
      @click="goLibrary"
    >
      文献库
    </button>
    <button
      :class="[
        'px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200',
        active === 'graph'
          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
      ]"
      @click="goGraph"
    >
      知识图谱
    </button>
  </div>
</template>
