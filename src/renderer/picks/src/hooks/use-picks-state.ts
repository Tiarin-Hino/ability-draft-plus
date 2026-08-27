import { useEffect, useState } from 'react'
import type { PicksStateMessage, PicksViewState } from '@shared/types/stream'
import { STREAM_PROTOCOL_VERSION } from '@shared/constants/thresholds'
import { buildDemoPicksState } from '../demo'

// @DEV-GUIDE: The picks SPA's only data source: an EventSource on the local stream
// server's /picks/events. Same-origin in production; in dev the page is served by the
// vite dev server and the ?api= query param carries the stream server origin.
// The payload is null until a draft has been recorded (the strip renders nothing —
// an empty transparent source in OBS). EventSource reconnects automatically.

export type PicksConnectionState = 'connecting' | 'connected' | 'disconnected'

export function apiBase(): string {
  return new URLSearchParams(window.location.search).get('api') ?? ''
}

/** ?demo=1 — fake complete draft for OBS scene setup and design preview. */
export function isDemoMode(): boolean {
  return new URLSearchParams(window.location.search).get('demo') === '1'
}

export function usePicksState(): {
  picks: PicksViewState | null
  connection: PicksConnectionState
} {
  const [picks, setPicks] = useState<PicksViewState | null>(() =>
    isDemoMode() ? buildDemoPicksState() : null,
  )
  const [connection, setConnection] = useState<PicksConnectionState>(() =>
    isDemoMode() ? 'connected' : 'connecting',
  )

  useEffect(() => {
    if (isDemoMode()) return

    const source = new EventSource(`${apiBase()}/picks/events`)

    source.onopen = () => setConnection('connected')
    source.onerror = () => setConnection('disconnected')
    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as PicksStateMessage
        if (message.v !== STREAM_PROTOCOL_VERSION || message.type !== 'picks') return
        setPicks(message.payload)
        setConnection('connected')
      } catch {
        // Malformed frame — ignore; the next push replaces the full state anyway.
      }
    }

    return () => source.close()
  }, [])

  return { picks, connection }
}
