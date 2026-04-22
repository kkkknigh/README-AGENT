import { createI18n } from 'vue-i18n'
import en from './en'
import zh from './zh'

// Get saved locale from localStorage or detect browser language
const getSavedLocale = (): string => {
  const saved = localStorage.getItem('readme_locale')
  if (saved && ['en', 'zh'].includes(saved)) {
    return saved
  }

  // Detect browser language
  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith('zh')) {
    return 'zh'
  }
  if (browserLang.startsWith('en')) {
    return 'en'
  }

  // Default to Chinese
  return 'zh'
}

const i18n = createI18n({
  legacy: false,
  locale: getSavedLocale(),
  fallbackLocale: 'zh',
  messages: {
    en,
    zh
  }
})

export default i18n
