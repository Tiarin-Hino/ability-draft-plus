import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { createWindrunApiClient } from '@core/scraper/windrun-api-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  pageFetch: vi.fn(),
  execute: vi.fn(),
  fromPartition: vi.fn(),
  windows: [] as unknown[],
}))
vi.mock('electron', () => {
  const browserSession = {
    fetch: mocks.fetch,
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  }
  mocks.fromPartition.mockReturnValue(browserSession)
  return {
    session: { fromPartition: mocks.fromPartition },
    BrowserWindow: class extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler: vi.fn(),
        executeJavaScript: mocks.execute,
        getURL: () => 'https://api.windrun.io/api/v2/static/heroes',
      })
      loadURL = vi.fn().mockResolvedValue(undefined)
      isDestroyed = () => false
      close = vi.fn(() => this.emit('closed'))
      show = vi.fn()
      focus = vi.fn()
      constructor(public options: unknown) {
        super()
        mocks.windows.push(this)
      }
    },
  }
})
import { BrowserWindow } from 'electron'
import { createWindrunBrowser } from '../../../../src/main/services/windrun-browser'

function currentWindow() {
  return mocks.windows.at(-1) as BrowserWindow
}

beforeEach(() => {
  mocks.windows.length = 0
  vi.clearAllMocks()
  mocks.pageFetch.mockReset()
  mocks.execute.mockImplementation((script: string) =>
    runInNewContext(script, {
      location: { origin: 'https://api.windrun.io' },
      fetch: mocks.pageFetch,
      AbortSignal,
    }),
  )
})

describe('Windrun browser recovery', () => {
  it('opens an isolated browser on the API origin, reuses it, and reports closing', () => {
    const changed = vi.fn()
    const browser = createWindrunBrowser(changed)
    browser.open('test-tag')
    expect(currentWindow()).toMatchObject({
      options: {
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      },
    })
    expect(currentWindow().loadURL).toHaveBeenCalledWith(
      'https://api.windrun.io/api/v2/static/heroes?idf=test-tag',
    )
    browser.open()
    expect(mocks.windows).toHaveLength(1)
    expect(currentWindow().focus).toHaveBeenCalled()
    browser.close()
    browser.close()
    expect(changed.mock.calls).toEqual([[true], [false]])
    browser.open()
    expect(mocks.windows).toHaveLength(2)
  })

  it('fetches inside the verified page with credentials, preserving queries and JSON', async () => {
    const browser = createWindrunBrowser(vi.fn())
    browser.open()
    mocks.pageFetch.mockResolvedValue(
      new Response('{"data":[]}', {
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = createWindrunApiClient(undefined, 'test-tag', browser.fetchRequest)
    expect(await client.fetchAbilities('7.40c')).toEqual({ data: [] })
    expect(mocks.pageFetch).toHaveBeenCalledWith(
      'https://api.windrun.io/api/v2/abilities?patch=7.40c&idf=test-tag',
      expect.objectContaining({ credentials: 'include', headers: { Accept: 'application/json' } }),
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(currentWindow().listenerCount('closed')).toBe(1)
  })

  it('preserves 403 for the recovery UI', async () => {
    const browser = createWindrunBrowser(vi.fn())
    browser.open()
    mocks.pageFetch.mockResolvedValue(new Response('challenge', { status: 403 }))
    const client = createWindrunApiClient(undefined, undefined, browser.fetchRequest)
    await expect(client.fetchStaticAbilities()).rejects.toMatchObject({ status: 403 })
  })

  it('rejects HTML verification pages with a useful message', async () => {
    const browser = createWindrunBrowser(vi.fn())
    browser.open()
    mocks.pageFetch.mockResolvedValue(
      new Response('<html>challenge</html>', {
        headers: { 'content-type': 'text/html' },
      }),
    )
    await expect(
      browser.fetchRequest('https://api.windrun.io/api/v2/abilities', {}),
    ).rejects.toThrow('verification page')
  })

  it('requires an open window and refuses other origins', async () => {
    const browser = createWindrunBrowser(vi.fn())
    await expect(
      browser.fetchRequest('https://api.windrun.io/api/v2/abilities', {}),
    ).rejects.toThrow('Open the Windrun browser')
    browser.open()
    await expect(browser.fetchRequest('https://example.com/', {})).rejects.toThrow('Unsupported')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects pending requests when the window closes', async () => {
    const browser = createWindrunBrowser(vi.fn())
    browser.open()
    mocks.execute.mockReturnValue(new Promise(() => {}))
    const result = browser.fetchRequest('https://api.windrun.io/api/v2/abilities', {})
    currentWindow().emit('closed')
    await expect(result).rejects.toThrow('was closed')
  })

  it('honors cancellation and removes request listeners', async () => {
    const browser = createWindrunBrowser(vi.fn())
    browser.open()
    mocks.execute.mockReturnValue(new Promise(() => {}))
    const controller = new AbortController()
    const result = browser.fetchRequest('https://api.windrun.io/api/v2/abilities', {
      signal: controller.signal,
    })
    controller.abort()
    await expect(result).rejects.toThrow('cancelled or timed out')
    expect(currentWindow().listenerCount('closed')).toBe(1)
  })

  it('times out even when page execution never settles', async () => {
    vi.useFakeTimers()
    try {
      const browser = createWindrunBrowser(vi.fn())
      browser.open()
      mocks.execute.mockReturnValue(new Promise(() => {}))
      const result = browser.fetchRequest('https://api.windrun.io/api/v2/abilities', {})
      const assertion = expect(result).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(30_000)
      await assertion
      expect(currentWindow().listenerCount('closed')).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not expose the client tag from script execution errors', async () => {
    const browser = createWindrunBrowser(vi.fn())
    browser.open()
    mocks.execute.mockRejectedValue(new Error('secret-tag'))
    const result = browser.fetchRequest(
      'https://api.windrun.io/api/v2/abilities?idf=secret-tag',
      {},
    )
    await expect(result).rejects.toThrow('Windrun browser request failed')
    await expect(result).rejects.not.toThrow('secret-tag')
  })

  it('blocks navigation away from Windrun', () => {
    createWindrunBrowser(vi.fn()).open()
    const event = { preventDefault: vi.fn() }
    currentWindow().webContents.emit('will-navigate', event, 'https://example.com/')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    event.preventDefault.mockClear()
    currentWindow().webContents.emit(
      'will-redirect',
      event,
      'https://api.windrun.io/api/v2/static/heroes',
    )
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
