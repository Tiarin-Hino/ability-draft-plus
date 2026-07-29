import { useEffect, useState } from 'react'
import type { StreamBoardState, StreamServerMessage } from '@shared/types/stream'
import { STREAM_PROTOCOL_VERSION } from '@shared/constants/thresholds'

// @DEV-GUIDE: The stream SPA's only data source: an EventSource on the local stream
// server. Same-origin in production; in dev the page is served by the vite dev server
// and the ?api= query param carries the stream server origin. EventSource reconnects
// automatically — 'disconnected' here just drives the status badge.

export type StreamConnectionState = 'connecting' | 'connected' | 'disconnected'

export function apiBase(): string {
  return new URLSearchParams(window.location.search).get('api') ?? ''
}

export function useStreamState(): {
  board: StreamBoardState | null
  connection: StreamConnectionState
} {
  const [board, setBoard] = useState<StreamBoardState | null>(null)
  const [connection, setConnection] = useState<StreamConnectionState>('connecting')

  useEffect(() => {
    const source = new EventSource(`${apiBase()}/events`)

    source.onopen = () => setConnection('connected')
    source.onerror = () => setConnection('disconnected')
    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as StreamServerMessage
        if (message.v !== STREAM_PROTOCOL_VERSION || message.type !== 'state') return
        setBoard(message.payload)
        setConnection('connected')
      } catch {
        // Malformed frame — ignore; the next push replaces the full state anyway.
      }
    }

    return () => source.close()
  }, [])

  return { board, connection }
}
