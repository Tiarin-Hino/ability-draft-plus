import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enCommon from '../locales/en/common.json'
import enSettings from '../locales/en/settings.json'
import enDashboard from '../locales/en/dashboard.json'
import enData from '../locales/en/data.json'
import enUpdate from '../locales/en/update.json'
import enFeedback from '../locales/en/feedback.json'
import enStreaming from '../locales/en/streaming.json'

import ruCommon from '../locales/ru/common.json'
import ruSettings from '../locales/ru/settings.json'
import ruDashboard from '../locales/ru/dashboard.json'
import ruData from '../locales/ru/data.json'
import ruUpdate from '../locales/ru/update.json'
import ruFeedback from '../locales/ru/feedback.json'
import ruStreaming from '../locales/ru/streaming.json'

import zhCNCommon from '../locales/zh-CN/common.json'
import zhCNSettings from '../locales/zh-CN/settings.json'
import zhCNDashboard from '../locales/zh-CN/dashboard.json'
import zhCNData from '../locales/zh-CN/data.json'
import zhCNUpdate from '../locales/zh-CN/update.json'
import zhCNFeedback from '../locales/zh-CN/feedback.json'
import zhCNStreaming from '../locales/zh-CN/streaming.json'

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      settings: enSettings,
      dashboard: enDashboard,
      data: enData,
      update: enUpdate,
      feedback: enFeedback,
      streaming: enStreaming,
    },
    ru: {
      common: ruCommon,
      settings: ruSettings,
      dashboard: ruDashboard,
      data: ruData,
      update: ruUpdate,
      feedback: ruFeedback,
      streaming: ruStreaming,
    },
    'zh-CN': {
      common: zhCNCommon,
      settings: zhCNSettings,
      dashboard: zhCNDashboard,
      data: zhCNData,
      update: zhCNUpdate,
      feedback: zhCNFeedback,
      streaming: zhCNStreaming,
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
