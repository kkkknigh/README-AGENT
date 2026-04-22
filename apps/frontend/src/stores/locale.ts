import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<string>('zh')

  // Initialize locale from localStorage or browser language
  const initLocale = () => {
    const saved = localStorage.getItem('readme_locale')
    if (saved && ['en', 'zh'].includes(saved)) {
      locale.value = saved
      return saved
    }

    // Detect browser language
    const browserLang = navigator.language.toLowerCase()
    if (browserLang.startsWith('zh')) {
      locale.value = 'zh'
      return 'zh'
    }
    if (browserLang.startsWith('en')) {
      locale.value = 'en'
      return 'en'
    }

    // Default to Chinese
    locale.value = 'zh'
    return 'zh'
  }

  // Set locale and persist to localStorage
  const setLocale = (newLocale: string) => {
    if (!['en', 'zh'].includes(newLocale)) {
      console.warn(`Unsupported locale: ${newLocale}`)
      return
    }

    locale.value = newLocale
    localStorage.setItem('readme_locale', newLocale)
  }

  return {
    locale,
    initLocale,
    setLocale
  }
})
