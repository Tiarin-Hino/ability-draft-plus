import { useDispatch as useZubridgeDispatch } from '@zubridge/electron'
import type { AppStoreState } from '@shared/types/app-store'

export function useAppDispatch() {
  return useZubridgeDispatch<AppStoreState>()
}
