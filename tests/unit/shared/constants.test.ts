import { describe, it, expect } from 'vitest'
import {
  ML_CONFIDENCE_THRESHOLD,
  WEIGHT_WINRATE,
  WEIGHT_PICK_ORDER,
  DEFAULT_OP_THRESHOLD,
  DEFAULT_TRAP_THRESHOLD,
  NUM_TOP_TIER_SUGGESTIONS,
  MIN_PICK_ORDER_FOR_NORMALIZATION,
  MAX_PICK_ORDER_FOR_NORMALIZATION,
  MODEL_INPUT_SIZE,
  MODEL_NUM_CLASSES,
  ML_WORKER_MAX_RESTART_ATTEMPTS,
} from '@shared/constants/thresholds'

describe('Business logic constants', () => {
  it('scoring weights sum to 1.0', () => {
    expect(WEIGHT_WINRATE + WEIGHT_PICK_ORDER).toBe(1.0)
  })

  it('ML confidence threshold is 90%', () => {
    expect(ML_CONFIDENCE_THRESHOLD).toBe(0.9)
  })

  it('default OP threshold is 13%', () => {
    expect(DEFAULT_OP_THRESHOLD).toBe(0.13)
  })

  it('default trap threshold is 5%', () => {
    expect(DEFAULT_TRAP_THRESHOLD).toBe(0.05)
  })

  it('top tier suggestions is 10', () => {
    expect(NUM_TOP_TIER_SUGGESTIONS).toBe(10)
  })

  it('pick order normalization range is 1-50', () => {
    expect(MIN_PICK_ORDER_FOR_NORMALIZATION).toBe(1.0)
    expect(MAX_PICK_ORDER_FOR_NORMALIZATION).toBe(50.0)
  })

  it('model input is 96x96 with 524 classes', () => {
    expect(MODEL_INPUT_SIZE).toBe(96)
    expect(MODEL_NUM_CLASSES).toBe(524)
  })

  it('worker max restart attempts is 3', () => {
    expect(ML_WORKER_MAX_RESTART_ATTEMPTS).toBe(3)
  })
})
