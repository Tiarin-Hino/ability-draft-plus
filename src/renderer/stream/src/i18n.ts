import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import ru from './locales/ru.json'
import zhCN from './locales/zh-CN.json'

// Language is driven by the server: StreamBoardState.meta.language mirrors the app's
// language setting, and App.tsx calls i18n.changeLanguage() when it changes.
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
    'zh-CN': { translation: zhCN },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
