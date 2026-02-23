import { Rect, Circle } from 'react-konva'
import type { ResolutionLayout, SlotCoordinate } from '@shared/types'

interface VerificationOverlayProps {
  layout: ResolutionLayout
}

const COLORS = {
  ultimates: 'rgba(0, 255, 255, 0.4)',
  standards: 'rgba(0, 255, 0, 0.4)',
  models: 'rgba(0, 100, 255, 0.4)',
  heroes: 'rgba(255, 0, 255, 0.4)',
  selected: 'rgba(255, 0, 0, 0.4)',
}

const STROKE_COLORS = {
  ultimates: '#00ffff',
  standards: '#00ff00',
  models: '#0064ff',
  heroes: '#ff00ff',
  selected: '#ff0000',
}

function SlotRects({
  slots,
  color,
  stroke,
}: {
  slots: SlotCoordinate[]
  color: string
  stroke: string
}) {
  return (
    <>
      {slots.map((slot, i) => (
        <Rect
          key={`${slot.hero_order}-${slot.x}-${slot.y}-${i}`}
          x={slot.x}
          y={slot.y}
          width={slot.width || 10}
          height={slot.height || 10}
          fill={color}
          stroke={stroke}
          strokeWidth={1}
        />
      ))}
    </>
  )
}

function SlotDots({
  slots,
  color,
}: {
  slots: SlotCoordinate[]
  color: string
}) {
  return (
    <>
      {slots.map((slot, i) => (
        <Circle
          key={`${slot.hero_order}-${slot.x}-${slot.y}-${i}`}
          x={slot.x}
          y={slot.y}
          radius={4}
          fill={color}
        />
      ))}
    </>
  )
}

export function VerificationOverlay({ layout }: VerificationOverlayProps) {
  return (
    <>
      <SlotRects
        slots={layout.ultimate_slots_coords}
        color={COLORS.ultimates}
        stroke={STROKE_COLORS.ultimates}
      />
      <SlotRects
        slots={layout.standard_slots_coords}
        color={COLORS.standards}
        stroke={STROKE_COLORS.standards}
      />
      {layout.models_coords && (
        <SlotRects
          slots={layout.models_coords}
          color={COLORS.models}
          stroke={STROKE_COLORS.models}
        />
      )}
      {layout.heroes_coords && (
        <SlotDots
          slots={layout.heroes_coords}
          color={STROKE_COLORS.heroes}
        />
      )}
      {layout.selected_abilities_coords && (
        <SlotDots
          slots={layout.selected_abilities_coords}
          color={STROKE_COLORS.selected}
        />
      )}
    </>
  )
}

export { STROKE_COLORS }
