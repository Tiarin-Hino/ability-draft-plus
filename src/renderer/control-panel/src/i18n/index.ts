import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enCommon from '../locales/en/common.json'
import enSettings from '../locales/en/settings.json'
import enDashboard from '../locales/en/dashboard.json'
import enData from '../locales/en/data.json'
import enUpdate from '../locales/en/update.json'
import enFeedback from '../locales/en/feedback.json'

import ruCommon from '../locales/ru/common.json'
import ruSettings from '../locales/ru/settings.json'
import ruDashboard from '../locales/ru/dashboard.json'
import ruData from '../locales/ru/data.json'
import ruUpdate from '../locales/ru/update.json'
import ruFeedback from '../locales/ru/feedback.json'

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      settings: enSettings,
      dashboard: enDashboard,
      data: enData,
      update: enUpdate,
      feedback: enFeedback,
    },
    ru: {
      common: ruCommon,
      settings: ruSettings,
      dashboard: ruDashboard,
      data: ruData,
      update: ruUpdate,
      feedback: ruFeedback,
    },
  },
  defaultNS: 'common',
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
