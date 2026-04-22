<script setup lang="ts">
import { useThemeStore } from './stores/theme'
// 全局初始化主题 Store，确保在应用启动时正确应用主题类（解决刷新后状态丢失问题）
useThemeStore()
</script>

<template>
  <router-view v-slot="{ Component }">
    <keep-alive :include="['WorkbenchLayout']">
      <component :is="Component" />
    </keep-alive>
  </router-view>
</template>
