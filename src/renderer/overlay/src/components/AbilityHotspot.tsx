import { useCallback } from 'react'
import type { EnrichedScanSlot } from '@shared/types'

interface AbilityHotspotProps {
  slot: EnrichedScanSlot
  scaleFactor: number
  isSelectedAbility: boolean
  isMySpotHero: boolean
  tooltipVisible: boolean
  onHover: (slot: EnrichedScanSlot, rect: DOMRect) => void
  onLeave: () => void
}

export function AbilityHotspot({
  slot,
  scaleFactor,
  isSelectedAbility,
  isMySpotHero,
  tooltipVisible,
  onHover,
  onLeave,
}: AbilityHotspotProps): React.ReactElement {
  const style: React.CSSProperties = {
    left: slot.coord.x / scaleFactor,
    top: slot.coord.y / scaleFactor,
    width: slot.coord.width / scaleFactor,
    height: slot.coord.height / scaleFactor,
  }

  let className = 'ability-hotspot'

  if (isSelectedAbility) {
    if (isMySpotHero) {
      className += ' my-spot-selected'
    }
  } else if (slot.isSynergySuggestionForMySpot) {
    className += ' shimmer-teal'
  } else if (slot.isGeneralTopTier) {
    className += ' shimmer-green'
  }

  if (tooltipVisible) {
    className += ' snapshot-hidden-border'
  }

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onHover(slot, e.currentTarget.getBoundingClientRect())
    },
    [slot, onHover],
  )

  return (
    <div
      className={className}
      style={style}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onLeave}
      data-ability-name={slot.displayName}
      aria-label={slot.displayName}
    />
  )
}
