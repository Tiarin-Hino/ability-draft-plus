import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enOverlay from '../locales/en/overlay.json'
import ruOverlay from '../locales/ru/overlay.json'

i18n.use(initReactI18next).init({
  resources: {
    en: { overlay: enOverlay },
    ru: { overlay: ruOverlay },
  },
  defaultNS: 'overlay',
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
