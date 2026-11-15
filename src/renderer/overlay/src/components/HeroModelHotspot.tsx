import { useCallback } from 'react'
import type { SlotBounds } from '@core/resolution/visual-geometry'
import type { HeroModelDisplay, SlotCoordinate } from '@shared/types'

interface HeroModelHotspotProps {
  model: HeroModelDisplay
  coord: SlotCoordinate
  scaleFactor: number
  resolvedBounds?: SlotBounds
  isMyModel: boolean
  perspectiveTransform?: string
  onHover: (model: HeroModelDisplay, rect: DOMRect) => void
  onLeave: () => void
}

export function HeroModelHotspot({
  model,
  coord,
  scaleFactor,
  resolvedBounds,
  isMyModel,
  perspectiveTransform,
  onHover,
  onLeave,
}: HeroModelHotspotProps): React.ReactElement {
  const style: React.CSSProperties = {
    left: resolvedBounds ? resolvedBounds.x : coord.x / scaleFactor,
    top: resolvedBounds ? resolvedBounds.y : coord.y / scaleFactor,
    width: resolvedBounds ? resolvedBounds.width : coord.width / scaleFactor,
    height: resolvedBounds ? resolvedBounds.height : coord.height / scaleFactor,
    ...(perspectiveTransform ? { transform: perspectiveTransform } : {}),
  }

  let className = 'hero-model-hotspot'

  if (isMyModel) {
    className += ' is-my-model'
  } else if (model.isGeneralTopTier) {
    className += ' shimmer-gold'
  }

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onHover(model, e.currentTarget.getBoundingClientRect())
    },
    [model, onHover],
  )

  return (
    <div
      className={className}
      style={style}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onLeave}
      data-hero-name={model.heroDisplayName}
      aria-label={model.heroDisplayName}
      id={`hero-model-hotspot-${model.heroOrder}`}
    >
      {/* Corner marker: recommended because of the linked profile's stats */}
      {model.isPersonallyDriven && <span className="personal-marker" />}
    </div>
  )
}
