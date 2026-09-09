import { useCallback } from 'react'
import type { EnrichedScanSlot } from '@shared/types'

interface AbilityHotspotProps {
  slot: EnrichedScanSlot
  scaleFactor: number
  isSelectedAbility: boolean
  isMySpotHero: boolean
  onHover: (slot: EnrichedScanSlot, rect: DOMRect) => void
  onLeave: () => void
}

export function AbilityHotspot({
  slot,
  scaleFactor,
  isSelectedAbility,
  isMySpotHero,
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
  } else if (slot.isUnknown) {
    className += ' unknown-slot'
  } else if (slot.isSynergySuggestionForMySpot) {
    className += ' shimmer-teal'
  } else if (slot.isGeneralTopTier) {
    className += ' shimmer-green'
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
    >
      {/* Corner marker: this slot is recommended because of the linked
          profile's personal stats (composes with any shimmer border) */}
      {slot.isPersonallyDriven && <span className="personal-marker" />}
      {/* Always-on Aghanim's markers (aghsMarkersEnabled setting, payload-
          gated in scan-processor): strong Shard = blue diamond bottom-left,
          strong Scepter = violet dot bottom-right. Pool slots only. */}
      {!isSelectedAbility && slot.goodShard && (
        <span className="aghs-marker aghs-marker-shard" />
      )}
      {!isSelectedAbility && slot.goodScepter && (
        <span className="aghs-marker aghs-marker-scepter" />
      )}
    </div>
  )
}
