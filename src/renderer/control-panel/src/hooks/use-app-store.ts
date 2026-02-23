import { createUseStore } from '@zubridge/electron'
import type { AppStoreState } from '@shared/types/app-store'

export const useAppStore = createUseStore<AppStoreState>()
