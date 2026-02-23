import type enCommon from '../locales/en/common.json'
import type enSettings from '../locales/en/settings.json'
import type enDashboard from '../locales/en/dashboard.json'
import type enData from '../locales/en/data.json'
import type enUpdate from '../locales/en/update.json'
import type enFeedback from '../locales/en/feedback.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof enCommon
      settings: typeof enSettings
      dashboard: typeof enDashboard
      data: typeof enData
      update: typeof enUpdate
      feedback: typeof enFeedback
    }
  }
}
