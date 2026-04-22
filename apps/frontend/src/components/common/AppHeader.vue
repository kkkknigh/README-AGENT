<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../../stores/auth'
import { useLocaleStore } from '../../stores/locale'
import { useThemeStore } from '../../stores/theme'

const router = useRouter()
const { t, locale } = useI18n()
const authStore = useAuthStore()
const localeStore = useLocaleStore()
const themeStore = useThemeStore()

const isLoggedIn = computed(() => authStore.isLoggedIn)
const isAdmin = computed(() => authStore.isAdmin)
const username = computed(() => authStore.user?.username || '')
const currentLanguageDisplay = computed(() => locale.value === 'zh' ? '中文' : 'EN')

const handleLogoClick = () => {
  router.push('/')
}

const handleReadPapersClick = () => {
  router.push('/reader')
}

const handleUserClick = () => {
  if (isLoggedIn.value) {
    router.push('/profile')
  } else {
    router.push('/login')
  }
}

const toggleLanguage = () => {
  const newLang = locale.value === 'zh' ? 'en' : 'zh'
  locale.value = newLang
  localeStore.setLocale(newLang)
}

const toggleTheme = () => {
  themeStore.toggleTheme()
}
</script>

<template>
  <header class="app-header">
    <!-- Left side: README logo -->
    <div class="header-left">
      <button @click="handleLogoClick" class="logo-button">
        <span class="logo-bracket">&lt;/</span><span class="logo-read">READ</span><span class="logo-me">ME</span><span class="logo-bracket">&gt;</span>
      </button>
    </div>

    <!-- Right side: Language switcher, Read Papers, User -->
    <div class="header-right">
      <button
        @click="toggleTheme"
        class="ui-btn header-chip-btn header-theme-btn interactive-3d"
        :title="themeStore.isDarkMode ? t('sidebar.switchToLight') : t('sidebar.switchToDark')"
      >
        <svg v-if="themeStore.isDarkMode" class="header-theme-icon header-theme-icon--sun" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <svg v-else class="header-theme-icon header-theme-icon--moon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      </button>

      <!-- Language Switcher Button -->
      <button @click="toggleLanguage" class="ui-btn header-chip-btn interactive-3d">
        {{ currentLanguageDisplay }}
      </button>

      <!-- Read Papers Button (only when logged in) -->
      <button
        v-if="isLoggedIn"
        @click="handleReadPapersClick"
        class="ui-btn header-chip-btn interactive-3d"
      >
        {{ t('common.readPapers') }}
      </button>

      <!-- Admin Button (only for admin users) -->
      <button
        v-if="isAdmin"
        @click="router.push('/admin')"
        class="ui-btn header-chip-btn header-admin-btn interactive-3d"
      >
        管理后台
      </button>

      <!-- User Avatar / Login Button -->
      <button @click="handleUserClick" class="user-button">
        <span v-if="isLoggedIn" class="user-avatar">
          {{ username.charAt(0).toUpperCase() }}
        </span>
        <span v-else class="login-text">
          {{ t('common.loginRegister') }}
        </span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: calc(var(--header-height) + var(--space-2));
  background: var(--c-bg-elevated);
  border-bottom: var(--border-width) solid var(--c-border-light);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(10px);
  padding: 0 var(--space-8);
  color: var(--c-text-primary);
}

.header-left {
  display: flex;
  align-items: center;
}

.logo-button {
  font-size: 1.24rem;
  font-weight: var(--font-bold);
  font-family: var(--font-logo);
  letter-spacing: -0.02em;
  background: none;
  border: none;
  cursor: pointer;
  transition: opacity var(--duration-normal);
  display: inline-flex;
  align-items: center;
}

.logo-bracket {
  color: var(--c-logo-bracket);
  font-weight: var(--font-normal);
}

.logo-read {
  color: var(--c-logo-read);
}

.logo-me {
  color: var(--c-logo-me);
}

.logo-button:hover {
  opacity: 0.8;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.header-chip-btn {
  border-radius: var(--radius-full);
  min-width: 3rem;
  padding: 0 var(--space-3);
  color: var(--c-btn-text);
}

.header-chip-btn:hover {
  color: var(--c-accent);
}

.header-theme-btn {
  min-width: var(--btn-height-md);
  width: var(--btn-height-md);
  padding: 0;
}

.header-theme-icon {
  width: var(--btn-icon-size);
  height: var(--btn-icon-size);
}

.header-theme-icon--sun {
  color: var(--c-sidebar-theme-sun);
}

.header-theme-icon--moon {
  color: var(--c-sidebar-theme-moon);
}

.header-admin-btn {
  color: var(--c-accent) !important;
  font-weight: 500;
}

.user-button {
  background: none;
  border: none;
  cursor: pointer;
  transition: opacity var(--duration-normal);
}

.user-button:hover {
  opacity: 0.8;
}

.user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  background: linear-gradient(135deg, var(--c-accent-gradient-start), var(--c-accent-gradient-end));
  color: var(--c-text-on-accent);
  border-radius: var(--radius-full);
  border: var(--border-width) solid var(--c-accent-gradient-border);
  font-weight: var(--font-bold);
  font-size: 0.8rem;
}

.login-text {
  color: var(--c-text-secondary);
  font-size: 0.8rem;
  font-weight: var(--font-medium);
}
</style>
