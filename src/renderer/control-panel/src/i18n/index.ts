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

import esCommon from '../locales/es/common.json'
import esSettings from '../locales/es/settings.json'
import esDashboard from '../locales/es/dashboard.json'
import esData from '../locales/es/data.json'
import esUpdate from '../locales/es/update.json'
import esFeedback from '../locales/es/feedback.json'
import esStreaming from '../locales/es/streaming.json'

import ptBRCommon from '../locales/pt-BR/common.json'
import ptBRSettings from '../locales/pt-BR/settings.json'
import ptBRDashboard from '../locales/pt-BR/dashboard.json'
import ptBRData from '../locales/pt-BR/data.json'
import ptBRUpdate from '../locales/pt-BR/update.json'
import ptBRFeedback from '../locales/pt-BR/feedback.json'
import ptBRStreaming from '../locales/pt-BR/streaming.json'

import ukCommon from '../locales/uk/common.json'
import ukSettings from '../locales/uk/settings.json'
import ukDashboard from '../locales/uk/dashboard.json'
import ukData from '../locales/uk/data.json'
import ukUpdate from '../locales/uk/update.json'
import ukFeedback from '../locales/uk/feedback.json'
import ukStreaming from '../locales/uk/streaming.json'

import filCommon from '../locales/fil/common.json'
import filSettings from '../locales/fil/settings.json'
import filDashboard from '../locales/fil/dashboard.json'
import filData from '../locales/fil/data.json'
import filUpdate from '../locales/fil/update.json'
import filFeedback from '../locales/fil/feedback.json'
import filStreaming from '../locales/fil/streaming.json'

import fiCommon from '../locales/fi/common.json'
import fiSettings from '../locales/fi/settings.json'
import fiDashboard from '../locales/fi/dashboard.json'
import fiData from '../locales/fi/data.json'
import fiUpdate from '../locales/fi/update.json'
import fiFeedback from '../locales/fi/feedback.json'
import fiStreaming from '../locales/fi/streaming.json'

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
    es: {
      common: esCommon,
      settings: esSettings,
      dashboard: esDashboard,
      data: esData,
      update: esUpdate,
      feedback: esFeedback,
      streaming: esStreaming,
    },
    'pt-BR': {
      common: ptBRCommon,
      settings: ptBRSettings,
      dashboard: ptBRDashboard,
      data: ptBRData,
      update: ptBRUpdate,
      feedback: ptBRFeedback,
      streaming: ptBRStreaming,
    },
    uk: {
      common: ukCommon,
      settings: ukSettings,
      dashboard: ukDashboard,
      data: ukData,
      update: ukUpdate,
      feedback: ukFeedback,
      streaming: ukStreaming,
    },
    fil: {
      common: filCommon,
      settings: filSettings,
      dashboard: filDashboard,
      data: filData,
      update: filUpdate,
      feedback: filFeedback,
      streaming: filStreaming,
    },
    fi: {
      common: fiCommon,
      settings: fiSettings,
      dashboard: fiDashboard,
      data: fiData,
      update: fiUpdate,
      feedback: fiFeedback,
      streaming: fiStreaming,
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
