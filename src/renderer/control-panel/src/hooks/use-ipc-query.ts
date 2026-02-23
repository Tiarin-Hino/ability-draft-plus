import { useState, useEffect, useReducer } from 'react'
import type { IpcInvokeMap } from '@shared/ipc/api'

interface UseIpcQueryReturn<K extends keyof IpcInvokeMap> {
  data: IpcInvokeMap[K]['response'] | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useIpcQuery<K extends keyof IpcInvokeMap>(
  channel: K,
  ...args: IpcInvokeMap[K]['request'] extends void ? [] : [IpcInvokeMap[K]['request']]
): UseIpcQueryReturn<K> {
  const [data, setData] = useState<IpcInvokeMap[K]['response'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchKey, refetch] = useReducer((x: number) => x + 1, 0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const request = args.length > 0
      ? window.electronApi.invoke(channel, args[0] as never)
      : window.electronApi.invoke(channel as never)

    request
      .then((result) => {
        if (!cancelled) {
          setData(result as IpcInvokeMap[K]['response'])
          setError(null)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, fetchKey])

  return { data, loading, error, refetch }
}
