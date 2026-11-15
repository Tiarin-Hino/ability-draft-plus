// Stable codes cross the main/renderer boundary; English details remain in logs.
const messages = {
  unsupported: 'Unsupported Windrun browser request',
  openRequired: 'Open the Windrun browser and complete the Cloudflare check first.',
  loading: 'Wait for the Windrun page to load before continuing.',
  timeout: 'Windrun browser request was cancelled or timed out.',
  closed: 'Windrun browser was closed. Reopen it and retry.',
  verification:
    'Windrun returned a verification page. Complete the Cloudflare check in the browser and retry.',
  failed:
    'Windrun browser request failed. Wait for the page to load, complete the Cloudflare check and retry.',
  openFailed: 'Could not open Windrun browser.',
  forbidden: 'Windrun denied access (403). Complete the Cloudflare check in the browser and retry.',
}

export type WindrunBrowserErrorCode = keyof typeof messages

export class WindrunBrowserError extends Error {
  constructor(public readonly code: WindrunBrowserErrorCode) {
    super(messages[code])
    this.name = 'WindrunBrowserError'
  }
}
