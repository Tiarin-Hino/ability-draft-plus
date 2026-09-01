import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enOverlay from '../locales/en/overlay.json'
import ruOverlay from '../locales/ru/overlay.json'
import zhCNOverlay from '../locales/zh-CN/overlay.json'
import esOverlay from '../locales/es/overlay.json'
import ptBROverlay from '../locales/pt-BR/overlay.json'
import ukOverlay from '../locales/uk/overlay.json'
import filOverlay from '../locales/fil/overlay.json'
import fiOverlay from '../locales/fi/overlay.json'

i18n.use(initReactI18next).init({
  resources: {
    en: { overlay: enOverlay },
    ru: { overlay: ruOverlay },
    'zh-CN': { overlay: zhCNOverlay },
    es: { overlay: esOverlay },
    'pt-BR': { overlay: ptBROverlay },
    uk: { overlay: ukOverlay },
    fil: { overlay: filOverlay },
    fi: { overlay: fiOverlay },
  },
  defaultNS: 'overlay',
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
