// Typed wrapper over the Twitch Extension Helper (window.Twitch.ext) — only the surface
// this extension uses. getTwitch() returns the real helper or a mock (demo / bare dev
// server) so every module can be exercised outside Twitch.

export interface TwitchAuth {
  channelId: string
  clientId: string
  token: string
  userId: string
  helixToken?: string
}

export interface TwitchContext {
  hlsLatencyBroadcaster?: number
  displayResolution?: string
  videoResolution?: string
  theme?: 'light' | 'dark'
  mode?: 'viewer' | 'dashboard' | 'config'
  isFullScreen?: boolean
  isTheatreMode?: boolean
  language?: string
}

export type BroadcastListener = (target: string, contentType: string, message: string) => void

export interface TwitchExt {
  onAuthorized(cb: (auth: TwitchAuth) => void): void
  onContext(cb: (context: TwitchContext, changed: string[]) => void): void
  listen(target: 'broadcast', cb: BroadcastListener): void
  unlisten(target: 'broadcast', cb: BroadcastListener): void
  configuration: {
    broadcaster?: { content: string; version: string }
    onChanged(cb: () => void): void
    set(segment: 'broadcaster', version: string, content: string): void
  }
  actions?: { minimize(): void }
}

declare global {
  interface Window {
    Twitch?: { ext: TwitchExt }
  }
}

export function hasRealTwitch(): boolean {
  return typeof window !== 'undefined' && !!window.Twitch?.ext
}

/** Mock helper for demo/dev: emits a fake authorization + context, exposes emit(). */
export interface MockTwitchExt extends TwitchExt {
  emit(message: string): void
  setContext(context: TwitchContext): void
}

export function createMockExt(options: {
  channelId?: string
  latencySec?: number
  videoResolution?: string
  configContent?: string
} = {}): MockTwitchExt {
  const listeners = new Set<BroadcastListener>()
  const contextListeners = new Set<(context: TwitchContext, changed: string[]) => void>()
  const configListeners = new Set<() => void>()
  let context: TwitchContext = {
    hlsLatencyBroadcaster: options.latencySec ?? 2,
    videoResolution: options.videoResolution ?? '1920x1080',
    theme: 'dark',
    mode: 'viewer',
  }
  const ext: MockTwitchExt = {
    onAuthorized(cb) {
      setTimeout(
        () =>
          cb({
            channelId: options.channelId ?? '123',
            clientId: 'dev-client-id',
            token: 'dev-token',
            userId: 'U123',
          }),
        0,
      )
    },
    onContext(cb) {
      contextListeners.add(cb)
      setTimeout(() => cb(context, Object.keys(context)), 0)
    },
    listen(_target, cb) {
      listeners.add(cb)
    },
    unlisten(_target, cb) {
      listeners.delete(cb)
    },
    configuration: {
      broadcaster: options.configContent ? { content: options.configContent, version: '1' } : undefined,
      onChanged(cb) {
        configListeners.add(cb)
      },
      set(_segment, version, content) {
        ext.configuration.broadcaster = { content, version }
        for (const cb of configListeners) cb()
      },
    },
    emit(message) {
      for (const cb of listeners) cb('broadcast', 'application/json', message)
    },
    setContext(next) {
      context = { ...context, ...next }
      for (const cb of contextListeners) cb(context, Object.keys(next))
    },
  }
  return ext
}

let mock: MockTwitchExt | null = null

export function getTwitch(): TwitchExt {
  if (hasRealTwitch()) return window.Twitch!.ext
  if (!mock) mock = createMockExt()
  return mock
}

export function getMockTwitch(): MockTwitchExt | null {
  return mock
}

export function installMockTwitch(instance: MockTwitchExt): void {
  mock = instance
}
