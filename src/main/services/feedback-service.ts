import { app } from 'electron'
import { join } from 'path'
import { mkdir, writeFile, readdir, rm, access } from 'fs/promises'
import log from 'electron-log/main'
import AdmZip from 'adm-zip'
import sharp from 'sharp'
import type { ApiConfig } from './api-config'
import { generateHmacSignature, generateNonce } from './api-config'
import type { DecodedScreenshot } from '@core/ml/preprocessing'

// @DEV-GUIDE: Backs the "Report Failed Recognition" loop. The overlay button saves a
// snapshot of the LAST FULL-BOARD SCAN (the exact screenshot the model classified, plus
// its raw predictions) — not a fresh capture, so the reported image always matches the
// misrecognition the user saw. Targeted auto-rescans (restricted to a few player rows,
// results often empty) are NOT recorded: they would replace the full-board snapshot
// with a near-useless one. Full scans recur at least once per round in auto mode, so
// the kept context stays fresh. The scan pipeline hands over the RAW bitmap (it never
// PNG-encodes); the PNG is produced HERE, lazily, only when the user actually files a
// report. Samples live under userData/feedback-samples/, one folder per snapshot
// (screenshot.png + metadata.json), pruned to MAX_STORED_SAMPLES.
//
// Export zips all samples to a user-chosen path (for attaching to GitHub issues).
// Upload POSTs each pending sample (zipped) to the feedback API endpoint using the
// same HMAC scheme as resolution:submitScreenshot; uploaded samples get a marker file
// so they are not re-sent. Upload requires apiConfig (absent in unofficial builds).

const logger = log.scope('feedback')

const MAX_STORED_SAMPLES = 25
const UPLOADED_MARKER = '.uploaded'
const UPLOAD_PATH = '/feedback-upload'

export interface ScanContext {
  screenshot: DecodedScreenshot
  resolution: string
  isInitialScan: boolean
  /**
   * Rescan only: player rows the scan was restricted to (targeted
   * auto-rescan). Undefined = full-board scan.
   */
  targetedRows?: number[]
  results: unknown
}

export interface SampleInfo {
  name: string
  path: string
  uploaded: boolean
}

export interface FeedbackService {
  recordScanContext(ctx: ScanContext): void
  hasScanContext(): boolean
  isUploadConfigured(): boolean
  saveSnapshot(): Promise<{ storedCount: number }>
  listSamples(): Promise<SampleInfo[]>
  exportSamples(targetZipPath: string): Promise<{ count: number }>
  uploadSamples(): Promise<{ uploaded: number; failed: number; total: number }>
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function createFeedbackService(apiConfig: ApiConfig | null): FeedbackService {
  const samplesRoot = join(app.getPath('userData'), 'feedback-samples')
  let lastScan: (ScanContext & { capturedAt: string }) | null = null

  async function listSamples(): Promise<SampleInfo[]> {
    if (!(await exists(samplesRoot))) return []
    const entries = await readdir(samplesRoot, { withFileTypes: true })
    const samples: SampleInfo[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('sample-')) continue
      const path = join(samplesRoot, entry.name)
      samples.push({
        name: entry.name,
        path,
        uploaded: await exists(join(path, UPLOADED_MARKER)),
      })
    }
    // Timestamp-based names sort chronologically
    samples.sort((a, b) => a.name.localeCompare(b.name))
    return samples
  }

  return {
    recordScanContext(ctx) {
      // Targeted auto-rescans cover only a few rows (their results are often
      // empty) — recording one would clobber the full-board snapshot the user
      // is actually reporting. Keep the last full scan instead.
      if (ctx.targetedRows) return
      lastScan = { ...ctx, capturedAt: new Date().toISOString() }
    },

    hasScanContext() {
      return lastScan !== null
    },

    isUploadConfigured() {
      return apiConfig !== null
    },

    async saveSnapshot() {
      if (!lastScan) {
        throw new Error('No scan context recorded')
      }

      const folderName = `sample-${lastScan.capturedAt.replace(/[:.]/g, '-')}`
      const sampleDir = join(samplesRoot, folderName)
      await mkdir(sampleDir, { recursive: true })

      const png = await sharp(lastScan.screenshot.data, {
        raw: {
          width: lastScan.screenshot.width,
          height: lastScan.screenshot.height,
          channels: 3,
        },
      })
        .png()
        .toBuffer()
      await writeFile(join(sampleDir, 'screenshot.png'), png)
      await writeFile(
        join(sampleDir, 'metadata.json'),
        JSON.stringify(
          {
            appVersion: app.getVersion(),
            capturedAt: lastScan.capturedAt,
            resolution: lastScan.resolution,
            isInitialScan: lastScan.isInitialScan,
            results: lastScan.results,
          },
          null,
          2,
        ),
      )

      // Prune oldest samples beyond the cap so disk use stays bounded
      const samples = await listSamples()
      const excess = samples.length - MAX_STORED_SAMPLES
      for (let i = 0; i < excess; i++) {
        await rm(samples[i].path, { recursive: true, force: true })
      }

      const storedCount = Math.min(samples.length, MAX_STORED_SAMPLES)
      logger.info('Feedback snapshot saved', { folderName, storedCount })
      return { storedCount }
    },

    listSamples,

    async exportSamples(targetZipPath) {
      const samples = await listSamples()
      const zip = new AdmZip()
      for (const sample of samples) {
        zip.addLocalFolder(sample.path, sample.name)
      }
      await zip.writeZipPromise(targetZipPath)
      logger.info('Feedback samples exported', { targetZipPath, count: samples.length })
      return { count: samples.length }
    },

    async uploadSamples() {
      if (!apiConfig) {
        throw new Error('API not configured')
      }

      const pending = (await listSamples()).filter((s) => !s.uploaded)
      let uploaded = 0
      let failed = 0

      for (const sample of pending) {
        try {
          const zip = new AdmZip()
          zip.addLocalFolder(sample.path)
          const body = zip.toBuffer()

          const timestamp = new Date().toISOString()
          const nonce = generateNonce()
          const signature = generateHmacSignature(
            apiConfig.sharedSecret,
            'POST',
            UPLOAD_PATH,
            timestamp,
            nonce,
            apiConfig.apiKey,
          )

          const response = await fetch(`${apiConfig.endpointUrl}${UPLOAD_PATH}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/zip',
              'x-sample-id': sample.name,
              'x-app-version': app.getVersion(),
              'x-api-key': apiConfig.apiKey,
              'x-request-timestamp': timestamp,
              'x-nonce': nonce,
              'x-signature': signature,
            },
            body,
          })

          if (!response.ok) {
            throw new Error(`API returned status ${response.status}`)
          }

          await writeFile(join(sample.path, UPLOADED_MARKER), '')
          uploaded++
        } catch (err) {
          failed++
          logger.error('Sample upload failed', {
            sample: sample.name,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      logger.info('Feedback upload finished', { uploaded, failed, total: pending.length })
      return { uploaded, failed, total: pending.length }
    },
  }
}
