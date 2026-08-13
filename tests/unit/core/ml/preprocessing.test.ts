import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SlotCoordinate } from '@shared/types'

// Mock sharp before importing the module under test (vi.hoisted so the
// factory can reference the mocks after vi.mock is hoisted to the top)
const { mockSharpChain, mockSharp } = vi.hoisted(() => {
  const chain = {
    extract: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    removeAlpha: vi.fn().mockReturnThis(),
    raw: vi.fn().mockReturnThis(),
    toBuffer: vi.fn(),
  }
  return { mockSharpChain: chain, mockSharp: vi.fn(() => chain) }
})

vi.mock('sharp', () => ({
  default: mockSharp,
}))

import {
  bufferToFloat32,
  cropTile,
  preprocessSlot,
  preprocessBatch,
} from '@core/ml/preprocessing'
import type { DecodedScreenshot } from '@core/ml/preprocessing'

// Sharp is mocked, so the bitmap only needs to be a stand-in — keep it tiny
// (deep-equality assertions on realistic multi-MB buffers time the test out).
function makeDecoded(width = 8, height = 6): DecodedScreenshot {
  return { data: Buffer.alloc(width * height * 3), width, height }
}

describe('preprocessing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('bufferToFloat32', () => {
    it('converts uint8 buffer values to float32', () => {
      const input = Buffer.from([0, 128, 255])
      const result = bufferToFloat32(input)

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(3)
      expect(result[0]).toBe(0)
      expect(result[1]).toBe(128)
      expect(result[2]).toBe(255)
    })

    it('preserves exact integer values as floats', () => {
      const input = Buffer.from([1, 2, 3, 4, 5])
      const result = bufferToFloat32(input)

      expect(Array.from(result)).toEqual([1, 2, 3, 4, 5])
    })

    it('returns empty Float32Array for empty buffer', () => {
      const input = Buffer.alloc(0)
      const result = bufferToFloat32(input)

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(0)
    })

    it('produces correct length for 96x96x3 image', () => {
      const input = Buffer.alloc(96 * 96 * 3, 127)
      const result = bufferToFloat32(input)

      expect(result.length).toBe(96 * 96 * 3)
      expect(result[0]).toBe(127)
    })
  })

  describe('cropTile', () => {
    it('crops from the raw bitmap and resizes to the requested square', async () => {
      const expectedOutput = Buffer.alloc(48 * 48 * 3, 7)
      mockSharpChain.toBuffer.mockResolvedValueOnce(expectedOutput)

      const screenshot = makeDecoded(8, 6)
      const result = await cropTile(
        screenshot,
        { x: 1, y: 2, width: 4, height: 3, hero_order: 5 },
        48,
      )

      expect(mockSharp).toHaveBeenCalledWith(screenshot.data, {
        raw: { width: 8, height: 6, channels: 3 },
      })
      expect(mockSharpChain.extract).toHaveBeenCalledWith({
        left: 1,
        top: 2,
        width: 4,
        height: 3,
      })
      expect(mockSharpChain.resize).toHaveBeenCalledWith(48, 48, { kernel: 'linear' })
      expect(result).toBe(expectedOutput)
    })
  })

  describe('preprocessSlot', () => {
    it('crops from the decoded bitmap with correct extract, resize, and raw pipeline', async () => {
      const expectedOutput = Buffer.alloc(96 * 96 * 3, 42)
      mockSharpChain.toBuffer.mockResolvedValueOnce(expectedOutput)

      const slot: SlotCoordinate = {
        x: 100,
        y: 200,
        width: 60,
        height: 70,
        hero_order: 0,
      }
      const screenshot = makeDecoded(8, 6)

      const result = await preprocessSlot(screenshot, slot)

      // Crops read from the raw bitmap — no PNG re-decode per slot
      expect(mockSharp).toHaveBeenCalledWith(screenshot.data, {
        raw: { width: 8, height: 6, channels: 3 },
      })
      expect(mockSharpChain.extract).toHaveBeenCalledWith({
        left: 100,
        top: 200,
        width: 60,
        height: 70,
      })
      // bilinear kernel matches the training pipeline's TF resize — lanczos
      // sharpening artifacts drop borderline classes below the 0.9 threshold
      expect(mockSharpChain.resize).toHaveBeenCalledWith(96, 96, { kernel: 'linear' })
      expect(mockSharpChain.raw).toHaveBeenCalled()
      expect(result).toBe(expectedOutput)
    })
  })

  describe('preprocessBatch', () => {
    it('processes valid slots and returns correct batch dimensions', async () => {
      const pixelBuffer = Buffer.alloc(96 * 96 * 3, 100)
      mockSharpChain.toBuffer.mockResolvedValue(pixelBuffer)

      const slots: SlotCoordinate[] = [
        { x: 10, y: 20, width: 50, height: 50, hero_order: 0 },
        { x: 70, y: 80, width: 50, height: 50, hero_order: 1 },
      ]

      const { batch, validIndices } = await preprocessBatch(
        makeDecoded(),
        slots,
      )

      expect(validIndices).toEqual([0, 1])
      expect(batch.length).toBe(2 * 96 * 96 * 3)
    })

    it('skips slots with zero width or height', async () => {
      const pixelBuffer = Buffer.alloc(96 * 96 * 3, 100)
      mockSharpChain.toBuffer.mockResolvedValue(pixelBuffer)

      const slots: SlotCoordinate[] = [
        { x: 10, y: 20, width: 0, height: 50, hero_order: 0 },
        { x: 70, y: 80, width: 50, height: 50, hero_order: 1 },
        { x: 90, y: 100, width: 50, height: 0, hero_order: 2 },
      ]

      const { batch, validIndices } = await preprocessBatch(
        makeDecoded(),
        slots,
      )

      expect(validIndices).toEqual([1])
      expect(batch.length).toBe(1 * 96 * 96 * 3)
    })

    it('skips slots that fail to preprocess', async () => {
      const pixelBuffer = Buffer.alloc(96 * 96 * 3, 100)
      mockSharpChain.toBuffer
        .mockRejectedValueOnce(new Error('crop failed'))
        .mockResolvedValueOnce(pixelBuffer)

      const slots: SlotCoordinate[] = [
        { x: 10, y: 20, width: 50, height: 50, hero_order: 0 },
        { x: 70, y: 80, width: 50, height: 50, hero_order: 1 },
      ]

      const { batch, validIndices } = await preprocessBatch(
        makeDecoded(),
        slots,
      )

      expect(validIndices).toEqual([1])
      expect(batch.length).toBe(1 * 96 * 96 * 3)
    })

    it('returns empty batch for empty slots array', async () => {
      const { batch, validIndices } = await preprocessBatch(
        makeDecoded(),
        [],
      )

      expect(validIndices).toEqual([])
      expect(batch.length).toBe(0)
    })

    it('concatenates batch data correctly', async () => {
      const buf1 = Buffer.alloc(96 * 96 * 3, 10)
      const buf2 = Buffer.alloc(96 * 96 * 3, 20)
      mockSharpChain.toBuffer
        .mockResolvedValueOnce(buf1)
        .mockResolvedValueOnce(buf2)

      const slots: SlotCoordinate[] = [
        { x: 0, y: 0, width: 50, height: 50, hero_order: 0 },
        { x: 50, y: 0, width: 50, height: 50, hero_order: 1 },
      ]

      const { batch } = await preprocessBatch(makeDecoded(), slots)

      // First image should be all 10s, second all 20s
      expect(batch[0]).toBe(10)
      expect(batch[96 * 96 * 3 - 1]).toBe(10)
      expect(batch[96 * 96 * 3]).toBe(20)
      expect(batch[2 * 96 * 96 * 3 - 1]).toBe(20)
    })
  })
})
