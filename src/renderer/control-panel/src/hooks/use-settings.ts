import { useState, useEffect, useCallback } from 'react'
import type { AppSettings } from '@shared/types'

interface UseSettingsReturn {
  settings: AppSettings | null
  loading: boolean
  error: string | null
  updateSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => Promise<void>
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronApi
      .invoke('settings:get')
      .then((data) => {
        if (!cancelled) {
          setSettings(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      const partial = { [key]: value } as Partial<AppSettings>
      await window.electronApi.invoke('settings:set', partial)
      setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
    },
    [],
  )

  return { settings, loading, error, updateSetting }
}
