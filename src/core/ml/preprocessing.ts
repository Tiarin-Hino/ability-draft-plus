import sharp from 'sharp'
import { MODEL_INPUT_SIZE } from '@shared/constants/thresholds'
import type { SlotCoordinate } from '@shared/types'

// @DEV-GUIDE: Image preprocessing for ML inference. Takes a raw screenshot buffer and
// layout coordinates, crops individual ability/hero slot images using sharp, resizes each
// to 96x96, and converts to float32 KEPT AT RAW 0-255 — deliberately NOT normalized.
// The ONNX graph contains a Rescaling(1/127.5, offset=-1) layer that maps 0-255 to
// [-1, 1] internally, matching the Keras training pipeline (training/train.py).
// extractSlots() handles both initial scan (all slots) and rescan (selected slots only).

const PIXELS_PER_IMAGE = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3

/**
 * Crops a single slot from a screenshot buffer and resizes to model input dimensions.
 * Returns raw RGB uint8 pixel data.
 */
export async function preprocessSlot(
  screenshotBuffer: Buffer,
  slot: SlotCoordinate,
): Promise<Buffer> {
  return sharp(screenshotBuffer)
    .extract({ left: slot.x, top: slot.y, width: slot.width, height: slot.height })
    // kernel MUST be 'linear' (bilinear): the training pipeline resizes with TF's
    // bilinear interpolation, and sharp's default lanczos3 produces sharpening
    // artifacts the model never saw — verified on a real capture to drop
    // borderline classes from ~0.7-0.9 confidence to ~0.26-0.72 (below the 0.9
    // threshold → rendered as Unknown). Train/serve resize kernels must match.
    .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, { kernel: 'linear' })
    .removeAlpha()
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
 * Preprocesses multiple slots from a screenshot into a batched Float32Array.
 * Returns a flat [N, 96, 96, 3] Float32Array and the indices of successfully processed slots.
 */
export async function preprocessBatch(
  screenshotBuffer: Buffer,
  slots: SlotCoordinate[],
): Promise<{ batch: Float32Array; validIndices: number[] }> {
  const validBuffers: Float32Array[] = []
  const validIndices: number[] = []

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    if (slot.width <= 0 || slot.height <= 0) continue
    try {
      const raw = await preprocessSlot(screenshotBuffer, slot)
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
