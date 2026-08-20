import sharp from 'sharp'
import { MODEL_INPUT_SIZE } from '@shared/constants/thresholds'
import type { SlotCoordinate } from '@shared/types'

// @DEV-GUIDE: Image preprocessing for ML inference. The screenshot arrives as a RAW
// 3-channel RGB bitmap (the capture path never PNG-encodes; the worker receives the
// bitmap as a transferred ArrayBuffer) and every slot crop reads from it directly.
// NEVER crop from an encoded buffer: that re-decoded the full 2560x1440 image per
// slot — ~1.1s for a 48-slot scan vs ~110ms from the shared bitmap.
// preprocessSlot crops one slot and resizes to 96x96; output is float32 KEPT AT RAW
// 0-255 — deliberately NOT normalized. The ONNX graph contains a
// Rescaling(1/127.5, offset=-1) layer that maps 0-255 to [-1, 1] internally, matching
// the Keras training pipeline (training/train.py).

const PIXELS_PER_IMAGE = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3

/** A raw RGB screenshot bitmap, ready for cheap per-slot cropping. */
export interface DecodedScreenshot {
  data: Buffer
  width: number
  height: number
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
 * Crops a region and encodes it as a grayscale PNG upscaled to a fixed width —
 * OCR input for the hero-name strips. The fixed width normalizes letter height
 * across game resolutions (small text upscaled is markedly better for
 * tesseract than native-size text).
 */
export async function cropRegionPng(
  screenshot: DecodedScreenshot,
  region: { x: number; y: number; width: number; height: number },
  targetWidth: number,
): Promise<Buffer> {
  return sharp(screenshot.data, {
    raw: { width: screenshot.width, height: screenshot.height, channels: 3 },
  })
    .extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height,
    })
    .resize(targetWidth, null, { kernel: 'lanczos3' })
    .grayscale()
    .normalise()
    .png()
    .toBuffer()
}

/**
 * Writes a raw RGB square vector to disk as a PNG — diagnostic sink for
 * rejected pick-slot crops (exactly what the template matcher saw).
 */
export async function saveRawVectorPng(
  vec: Uint8Array,
  size: number,
  filePath: string,
): Promise<void> {
  await sharp(Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength), {
    raw: { width: size, height: size, channels: 3 },
  })
    .png()
    .toFile(filePath)
}

/**
 * Decodes an icon image FILE (PNG) and resizes to a square raw RGB vector —
 * used to build pick-slot template-matching candidates from the cached
 * official CDN icons. Alpha is stripped so vectors align with screenshot crops.
 */
export async function loadIconVector(
  filePath: string,
  size: number,
): Promise<Uint8Array> {
  const raw = await sharp(filePath)
    .resize(size, size, { kernel: 'linear' })
    .removeAlpha()
    .raw()
    .toBuffer()
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
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
