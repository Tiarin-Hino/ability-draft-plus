import sharp from 'sharp'
import { MODEL_INPUT_SIZE } from '@shared/constants/thresholds'
import type { SlotCoordinate } from '@shared/types'

// @DEV-GUIDE: Image preprocessing for ML inference. Takes a raw screenshot buffer and
// layout coordinates, crops individual ability/hero slot images using sharp, resizes each
// to 96x96, and normalizes pixel values to float32 [0, 1] range.
// extractSlots() handles both initial scan (all slots) and rescan (selected slots only).
//
// Note: bufferToFloat32 keeps values as 0-255 floats because the ONNX model's internal
// Rescaling layer handles the /255 normalization. This matches the Keras training pipeline.

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
    .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
    .removeAlpha()
    .raw()
    .toBuffer()
}

/**
 * Converts a raw uint8 RGB buffer to Float32Array.
 * Values are kept as 0-255 floats -- the model's Rescaling layer handles /255 internally.
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
