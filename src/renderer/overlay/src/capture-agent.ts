import type { IpcOnMap } from '@shared/ipc/api'
import {
  CAPTURE_STREAM_MAX_FPS,
  CAPTURE_FIRST_FRAME_TIMEOUT_MS,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: Renderer half of the cached-source scan capture (see
// cached-window-capture-service.ts in main for the why + fallback story).
// Main resolves the game window's desktopCapturer source id once and asks this
// agent for frames; the agent keeps a getUserMedia(chromeMediaSourceId) stream
// alive between scans so each grab costs one canvas draw instead of a full
// getSources enumeration (~800ms saved per scan).
//
// Runs OUTSIDE React (initialized from main.tsx): pure IPC + DOM, no UI. The
// video element is never attached to the document — Chromium delivers
// MediaStream frames to detached elements just fine, and the overlay stays
// visually untouched. drawImage + getImageData normalizes whatever pixel
// format WGC delivers (BGRA GPU textures) into tightly-packed RGBA; main
// drops the alpha channel.
//
// Requests are serialized through a promise chain: interleaved frame/stop
// messages (e.g. a manual rescan racing the auto-rescan tick) each see a
// consistent stream state. Every failure answers ok:false so main falls back
// to its getSources path; a dying track (game window closed/recreated on
// resolution change) reports capture:sessionEnded so main re-resolves the id.

/** Electron's legacy desktop-capture getUserMedia constraints (not in lib.dom). */
interface DesktopCaptureConstraints {
  audio: false
  video: {
    mandatory: {
      chromeMediaSource: 'desktop'
      chromeMediaSourceId: string
      maxWidth: number
      maxHeight: number
      maxFrameRate: number
    }
  }
}

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let activeSourceId: string | null = null
let canvas: HTMLCanvasElement | null = null

/** Serializes frame/stop handling so stream state never races. */
let opChain: Promise<void> = Promise.resolve()
function enqueue(op: () => Promise<void> | void): void {
  opChain = opChain.then(op).catch(() => undefined)
}

function handleTrackEnded(): void {
  enqueue(() => {
    stopStream()
    window.electronApi.send('capture:sessionEnded')
  })
}

function stopStream(): void {
  if (stream) {
    for (const track of stream.getTracks()) {
      track.removeEventListener('ended', handleTrackEnded)
      track.stop()
    }
  }
  if (video) {
    video.srcObject = null
  }
  stream = null
  video = null
  activeSourceId = null
}

async function startStream(req: IpcOnMap['capture:frame']): Promise<void> {
  stopStream()
  const constraints: DesktopCaptureConstraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: req.sourceId,
        maxWidth: req.maxWidth,
        maxHeight: req.maxHeight,
        maxFrameRate: CAPTURE_STREAM_MAX_FPS,
      },
    },
  }
  const newStream = await navigator.mediaDevices.getUserMedia(
    constraints as unknown as MediaStreamConstraints,
  )
  const newVideo = document.createElement('video')
  newVideo.muted = true
  newVideo.srcObject = newStream
  try {
    await newVideo.play()
    // Wait for an actual composited frame — videoWidth is 0 until then, and
    // the very first WGC session start is where the known ~300ms
    // "Failed to start capture" retry quirk lives.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for first capture frame')),
        CAPTURE_FIRST_FRAME_TIMEOUT_MS,
      )
      newVideo.requestVideoFrameCallback(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  } catch (error) {
    newVideo.srcObject = null
    for (const track of newStream.getTracks()) track.stop()
    throw error
  }
  for (const track of newStream.getTracks()) {
    track.addEventListener('ended', handleTrackEnded)
  }
  stream = newStream
  video = newVideo
  activeSourceId = req.sourceId
}

async function handleFrameRequest(req: IpcOnMap['capture:frame']): Promise<void> {
  try {
    if (video === null || activeSourceId !== req.sourceId) {
      await startStream(req)
    }
    const v = video
    if (!v || v.videoWidth === 0 || v.videoHeight === 0) {
      throw new Error('Capture stream has no frame')
    }
    canvas ??= document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      throw new Error('Canvas 2d context unavailable')
    }
    ctx.drawImage(v, 0, 0)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    window.electronApi.send('capture:frameResult', {
      requestId: req.requestId,
      ok: true,
      width: image.width,
      height: image.height,
      data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    })
  } catch (error) {
    stopStream()
    window.electronApi.send('capture:frameResult', {
      requestId: req.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Idempotent per page load; called once from main.tsx (outside React). */
export function initCaptureAgent(): void {
  window.electronApi.on('capture:frame', (req) => {
    enqueue(() => handleFrameRequest(req))
  })
  window.electronApi.on('capture:stop', () => {
    enqueue(() => stopStream())
  })
}
