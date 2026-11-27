import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScraperResult } from '@core/scraper/types'
import type { DatabaseService } from '../../../../src/main/services/database-service'
import { createAppStore } from '../../../../src/main/store/app-store'

const mocks = vi.hoisted(() => ({
  scrape: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  fetchRequest: vi.fn(),
  createClient: vi.fn(),
}))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/tmp/windrun-test' } }))
vi.mock('electron-log/main', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))
vi.mock('@core/scraper', () => ({
  performFullScrape: mocks.scrape,
  performLiquipediaEnrichment: vi.fn(),
  createWindrunApiClient: mocks.createClient,
}))
vi.mock('../../../../src/main/services/api-config', () => ({ loadClientTag: () => 'test-tag' }))
vi.mock('../../../../src/main/services/windrun-browser', () => ({
  createWindrunBrowser: () => ({
    open: mocks.open,
    close: mocks.close,
    fetchRequest: mocks.fetchRequest,
  }),
}))
import { createScraperService } from '../../../../src/main/services/scraper-service'

beforeEach(() => vi.resetAllMocks())

function setup() {
  const store = createAppStore()
  const db = {
    metadata: { getLastScrapeDate: () => '2026-09-18', set: vi.fn() },
    persist: vi.fn(),
  } as unknown as DatabaseService
  return { store, service: createScraperService(db, store) }
}

// Let the service's fire-and-forget result/finally handlers settle.
async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('Windrun browser scrape lifecycle', () => {
  it('closes the browser only after a successful browser scrape', async () => {
    let finish!: (result: ScraperResult) => void
    mocks.scrape.mockReturnValue(
      new Promise<ScraperResult>((resolve) => {
        finish = resolve
      }),
    )
    const { service, store } = setup()
    service.startScrape(true)
    expect(mocks.createClient).toHaveBeenCalledWith(undefined, 'test-tag', mocks.fetchRequest)
    expect(mocks.close).not.toHaveBeenCalled()
    service.startScrape(true)
    expect(mocks.scrape).toHaveBeenCalledOnce()
    finish({ success: true })
    await settle()
    expect(store.getState().scraperStatus).toBe('idle')
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('keeps the browser open after failure and clears the localized error on retry', async () => {
    mocks.scrape.mockResolvedValueOnce({
      success: false,
      browserRequired: true,
      browserError: 'forbidden',
      error: '403',
    })
    const { service, store } = setup()
    service.startScrape(true)
    await settle()
    expect(store.getState()).toMatchObject({
      scraperStatus: 'error',
      scraperBrowserError: 'forbidden',
    })
    expect(mocks.close).not.toHaveBeenCalled()
    mocks.scrape.mockResolvedValueOnce({ success: true })
    service.startScrape(true)
    expect(store.getState().scraperBrowserError).toBeNull()
    await settle()
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('does not close the browser after a direct scrape', async () => {
    mocks.scrape.mockResolvedValue({ success: true })
    const { service } = setup()
    service.startScrape()
    await settle()
    expect(mocks.createClient).toHaveBeenCalledWith(undefined, 'test-tag', undefined)
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it('exposes a localizable error when opening fails', () => {
    mocks.open.mockImplementation(() => {
      throw new Error('Window failure')
    })
    const { service, store } = setup()
    service.openBrowser()
    expect(store.getState()).toMatchObject({
      scraperStatus: 'error',
      scraperBrowserError: 'openFailed',
    })
  })
})
