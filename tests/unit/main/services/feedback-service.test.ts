import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import AdmZip from 'adm-zip'

let userDataDir: string

// Mock electron — feedback service resolves its sample root from app.getPath('userData')
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir
      throw new Error(`Unexpected getPath: ${name}`)
    },
    getVersion: () => '2.0.2-test',
  },
}))

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

import { createFeedbackService } from '../../../../src/main/services/feedback-service'
import type { ApiConfig } from '../../../../src/main/services/api-config'

const API_CONFIG: ApiConfig = {
  endpointUrl: 'https://api.example.com',
  apiKey: 'test-key',
  sharedSecret: 'test-secret',
}

function makeContext(overrides: Partial<Parameters<ReturnType<typeof createFeedbackService>['recordScanContext']>[0]> = {}) {
  return {
    screenshot: Buffer.from('fake-png-bytes'),
    resolution: '1920x1080',
    isInitialScan: true,
    results: { ultimates: [{ name: 'test_ability', confidence: 0.97 }] },
    ...overrides,
  }
}

describe('feedback-service', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'adp-feedback-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('scan context', () => {
    it('has no scan context initially', () => {
      const service = createFeedbackService(null)
      expect(service.hasScanContext()).toBe(false)
    })

    it('has scan context after recording', () => {
      const service = createFeedbackService(null)
      service.recordScanContext(makeContext())
      expect(service.hasScanContext()).toBe(true)
    })

    it('saveSnapshot throws without a recorded scan', async () => {
      const service = createFeedbackService(null)
      await expect(service.saveSnapshot()).rejects.toThrow('No scan context')
    })
  })

  describe('saveSnapshot', () => {
    it('writes screenshot.png and metadata.json into a sample folder', async () => {
      const service = createFeedbackService(null)
      service.recordScanContext(makeContext())

      const { storedCount } = await service.saveSnapshot()
      expect(storedCount).toBe(1)

      const root = join(userDataDir, 'feedback-samples')
      const folders = readdirSync(root)
      expect(folders).toHaveLength(1)
      expect(folders[0]).toMatch(/^sample-/)

      const sampleDir = join(root, folders[0])
      expect(existsSync(join(sampleDir, 'screenshot.png'))).toBe(true)

      const metadata = JSON.parse(readFileSync(join(sampleDir, 'metadata.json'), 'utf-8'))
      expect(metadata.appVersion).toBe('2.0.2-test')
      expect(metadata.resolution).toBe('1920x1080')
      expect(metadata.isInitialScan).toBe(true)
      expect(metadata.results.ultimates[0].name).toBe('test_ability')
    })

    it('prunes the oldest samples beyond the cap', async () => {
      const service = createFeedbackService(null)
      const root = join(userDataDir, 'feedback-samples')

      // Save one real snapshot, then simulate 25 pre-existing older ones
      service.recordScanContext(makeContext())
      await service.saveSnapshot()
      const [realSample] = readdirSync(root)

      for (let i = 10; i < 35; i++) {
        // Names sort lexically before 'sample-2...' timestamps
        const dir = join(root, `sample-0000-old-${i}`)
        const { mkdirSync } = await import('fs')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'screenshot.png'), 'x')
      }

      service.recordScanContext(makeContext())
      await service.saveSnapshot()

      const remaining = readdirSync(root)
      expect(remaining.length).toBe(25)
      // The newest (real) samples survive; the oldest synthetic ones are pruned first
      expect(remaining).toContain(realSample)
    })
  })

  describe('listSamples', () => {
    it('returns empty list when nothing has been saved', async () => {
      const service = createFeedbackService(null)
      expect(await service.listSamples()).toEqual([])
    })

    it('marks samples with an .uploaded marker as uploaded', async () => {
      const service = createFeedbackService(null)
      service.recordScanContext(makeContext())
      await service.saveSnapshot()

      const root = join(userDataDir, 'feedback-samples')
      const [folder] = readdirSync(root)
      writeFileSync(join(root, folder, '.uploaded'), '')

      const samples = await service.listSamples()
      expect(samples).toHaveLength(1)
      expect(samples[0].uploaded).toBe(true)
    })
  })

  describe('exportSamples', () => {
    it('writes a zip containing every sample folder', async () => {
      const service = createFeedbackService(null)
      service.recordScanContext(makeContext())
      await service.saveSnapshot()
      service.recordScanContext(makeContext({ isInitialScan: false }))
      await service.saveSnapshot()

      const target = join(userDataDir, 'export.zip')
      const { count } = await service.exportSamples(target)
      expect(count).toBe(2)

      const zip = new AdmZip(target)
      const entries = zip.getEntries().map((e) => e.entryName)
      expect(entries.some((e) => e.endsWith('screenshot.png'))).toBe(true)
      expect(entries.some((e) => e.endsWith('metadata.json'))).toBe(true)
    })
  })

  describe('uploadSamples', () => {
    it('reports upload as unconfigured without apiConfig', () => {
      const service = createFeedbackService(null)
      expect(service.isUploadConfigured()).toBe(false)
    })

    it('throws without apiConfig', async () => {
      const service = createFeedbackService(null)
      await expect(service.uploadSamples()).rejects.toThrow('API not configured')
    })

    it('POSTs pending samples with HMAC headers and marks them uploaded', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      vi.stubGlobal('fetch', fetchMock)

      const service = createFeedbackService(API_CONFIG)
      service.recordScanContext(makeContext())
      await service.saveSnapshot()

      const result = await service.uploadSamples()
      expect(result).toEqual({ uploaded: 1, failed: 0, total: 1 })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.example.com/feedback-upload')
      expect(init.method).toBe('POST')
      expect(init.headers['Content-Type']).toBe('application/zip')
      expect(init.headers['x-api-key']).toBe('test-key')
      expect(init.headers['x-signature']).toMatch(/^[0-9a-f]{64}$/)
      expect(Buffer.isBuffer(init.body)).toBe(true)

      // Marked uploaded → second upload run has nothing to do
      const again = await service.uploadSamples()
      expect(again).toEqual({ uploaded: 0, failed: 0, total: 0 })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('counts failed uploads without marking them uploaded', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 })
      vi.stubGlobal('fetch', fetchMock)

      const service = createFeedbackService(API_CONFIG)
      service.recordScanContext(makeContext())
      await service.saveSnapshot()

      const result = await service.uploadSamples()
      expect(result).toEqual({ uploaded: 0, failed: 1, total: 1 })

      const samples = await service.listSamples()
      expect(samples[0].uploaded).toBe(false)
    })
  })
})
