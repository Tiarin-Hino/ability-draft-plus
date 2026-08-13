import sharp from 'sharp'
import { MODEL_INPUT_SIZE } from '@shared/constants/thresholds'
import type { SlotCoordinate } from '@shared/types'

// @DEV-GUIDE: Image preprocessing for ML inference. The screenshot arrives PNG-encoded;
// decodeScreenshot() decodes it ONCE to a raw RGB bitmap, and every slot crop then reads
// from that bitmap. (Cropping straight from the PNG buffer re-decoded the full 2560x1440
// image per slot — ~1.1s for a 48-slot scan vs ~110ms with the single decode.)
// preprocessSlot crops one slot and resizes to 96x96; output is float32 KEPT AT RAW
// 0-255 — deliberately NOT normalized. The ONNX graph contains a
// Rescaling(1/127.5, offset=-1) layer that maps 0-255 to [-1, 1] internally, matching
// the Keras training pipeline (training/train.py).

const PIXELS_PER_IMAGE = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3

/** A screenshot decoded once to raw RGB, ready for cheap per-slot cropping. */
export interface DecodedScreenshot {
  data: Buffer
  width: number
  height: number
}

/**
 * Decodes a PNG screenshot buffer to a raw 3-channel RGB bitmap.
 * Do this once per scan; all slot crops read from the decoded bitmap.
 */
export async function decodeScreenshot(
  screenshotBuffer: Buffer,
): Promise<DecodedScreenshot> {
  const { data, info } = await sharp(screenshotBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/**
 * Crops a single slot from a decoded screenshot and resizes to model input dimensions.
 * Returns raw RGB uint8 pixel data.
 */
export async function preprocessSlot(
  screenshot: DecodedScreenshot,
  slot: SlotCoordinate,
): Promise<Buffer> {
  return sharp(screenshot.data, {
    raw: { width: screenshot.width, height: screenshot.height, channels: 3 },
  })
    .extract({ left: slot.x, top: slot.y, width: slot.width, height: slot.height })
    // kernel MUST be 'linear' (bilinear): the training pipeline resizes with TF's
    // bilinear interpolation, and sharp's default lanczos3 produces sharpening
    // artifacts the model never saw — verified on a real capture to drop
    // borderline classes from ~0.7-0.9 confidence to ~0.26-0.72 (below the 0.9
    // threshold → rendered as Unknown). Train/serve resize kernels must match.
    .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, { kernel: 'linear' })
    .raw()
    .toBuffer()
}

/**
 * Crops one slot from a decoded screenshot and resizes to an arbitrary square —
 * used for model-tile capture (picked-model diff detection), where the size is
 * a comparison normalization, not a model input.
 */
export async function cropTile(
  screenshot: DecodedScreenshot,
  slot: SlotCoordinate,
  size: number,
): Promise<Buffer> {
  return sharp(screenshot.data, {
    raw: { width: screenshot.width, height: screenshot.height, channels: 3 },
  })
    .extract({ left: slot.x, top: slot.y, width: slot.width, height: slot.height })
    .resize(size, size, { kernel: 'linear' })
    .raw()
    .toBuffer()
}

/**
 * Converts a raw uint8 RGB buffer to Float32Array.
 * Values are kept as 0-255 floats -- the model's Rescaling layer maps them to [-1, 1]
 * internally (x/127.5 - 1).
 */
export function bufferToFloat32(rawBuffer: Buffer): Float32Array {
  const float32 = new Float32Array(rawBuffer.length)
  for (let i = 0; i < rawBuffer.length; i++) {
    float32[i] = rawBuffer[i]
  }
  return float32
}

/**
 * Preprocesses multiple slots from a decoded screenshot into a batched Float32Array.
 * Returns a flat [N, 96, 96, 3] Float32Array and the indices of successfully processed slots.
 */
export async function preprocessBatch(
  screenshot: DecodedScreenshot,
  slots: SlotCoordinate[],
): Promise<{ batch: Float32Array; validIndices: number[] }> {
  const validBuffers: Float32Array[] = []
  const validIndices: number[] = []

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    if (slot.width <= 0 || slot.height <= 0) continue
    try {
      const raw = await preprocessSlot(screenshot, slot)
      validBuffers.push(bufferToFloat32(raw))
      validIndices.push(i)
    } catch {
      // Skip slots that fail to preprocess (e.g. out-of-bounds crops)
    }
  }

  const batch = new Float32Array(validBuffers.length * PIXELS_PER_IMAGE)
  for (let i = 0; i < validBuffers.length; i++) {
    batch.set(validBuffers[i], i * PIXELS_PER_IMAGE)
  }

  return { batch, validIndices }
}
