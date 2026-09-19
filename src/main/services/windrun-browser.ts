import { WindrunBrowserError } from '@shared/windrun-browser-error'
import { BrowserWindow, session } from 'electron'
import type { WindrunFetch } from '@core/scraper/windrun-api-client'

const ORIGIN = 'https://api.windrun.io'

/** Isolated browser session: no app preload or Node access for remote content. */
export function createWindrunBrowser(onOpenChanged: (open: boolean) => void) {
  let window: BrowserWindow | null = null

  function open(clientTag?: string): void {
    if (window && !window.isDestroyed()) {
      window.show()
      window.focus()
      return
    }
    const browserSession = session.fromPartition('persist:windrun-browser')
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    )
    browserSession.setPermissionCheckHandler(() => false)
    const current = new BrowserWindow({
      width: 1000,
      height: 760,
      title: 'Windrun — Cloudflare',
      autoHideMenuBar: true,
      webPreferences: {
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    window = current
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const guardNavigation = (event: Electron.Event, url: string) => {
      if (new URL(url).origin !== ORIGIN) event.preventDefault()
    }
    current.webContents.on('will-navigate', guardNavigation)
    current.webContents.on('will-redirect', guardNavigation)
    current.on('closed', () => {
      window = null
      onOpenChanged(false)
    })
    onOpenChanged(true)
    // Navigate to the API origin itself: clearance on windrun.io alone is insufficient.
    // HTTP challenge pages can reject loadURL while still being visible to the user.
    const url = new URL('/api/v2/static/heroes', ORIGIN)
    if (clientTag) url.searchParams.set('idf', clientTag)
    void current.loadURL(url.toString()).catch(() => {})
  }

  const fetchRequest: WindrunFetch = async (url, init) => {
    if (new URL(url).origin !== ORIGIN) {
      throw new WindrunBrowserError('unsupported')
    }
    const current = window
    if (!current || current.isDestroyed()) {
      throw new WindrunBrowserError('openRequired')
    }
    if (!current.webContents.getURL().startsWith(`${ORIGIN}/`)) {
      throw new WindrunBrowserError('loading')
    }
    if (init.signal?.aborted) throw new WindrunBrowserError('timeout')

    // session.fetch runs outside the page context and can still receive 403 after
    // a successful challenge. Run same-origin fetch in the verified page itself.
    // Pass the URL as a JSON literal; never interpolate it as executable code.
    const script = `(async () => {
      if (location.origin !== ${JSON.stringify(ORIGIN)}) throw new Error('Wrong origin');
      const response = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      return {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type') || '',
        body: await response.text(),
      };
    })()`

    return new Promise<Response>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        init.signal?.removeEventListener('abort', onAbort)
        current.removeListener('closed', onClosed)
      }
      const fail = (error: Error) => {
        cleanup()
        reject(error)
      }
      const onAbort = () => fail(new WindrunBrowserError('timeout'))
      const onClosed = () => fail(new WindrunBrowserError('closed'))
      const timer = setTimeout(onAbort, 30_000)
      init.signal?.addEventListener('abort', onAbort, { once: true })
      current.once('closed', onClosed)
      void Promise.resolve()
        .then(() => {
          if (current.isDestroyed() || init.signal?.aborted) {
            throw new Error('Browser request cancelled')
          }
          return current.webContents.executeJavaScript(script)
        })
        .then(
          (result: { status: number; statusText: string; contentType: string; body: string }) => {
            // A challenge page can return 200 as well; do not pass HTML to JSON.parse.
            if (result.status === 200 && !result.contentType.toLowerCase().includes('json')) {
              fail(new WindrunBrowserError('verification'))
              return
            }
            const response = new Response(
              [204, 205, 304].includes(result.status) ? null : result.body,
              {
                status: result.status,
                statusText: result.statusText,
                headers: { 'content-type': result.contentType },
              },
            )
            cleanup()
            resolve(response)
          },
        )
        .catch(() => {
          // Electron exceptions can contain the script/URL, including the client tag.
          fail(new WindrunBrowserError('failed'))
        })
    })
  }

  function close(): void {
    if (window && !window.isDestroyed()) window.close()
  }

  return { open, close, fetchRequest }
}
