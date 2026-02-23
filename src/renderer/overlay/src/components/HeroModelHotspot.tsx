import { useCallback } from 'react'
import type { HeroModelDisplay, SlotCoordinate } from '@shared/types'

interface HeroModelHotspotProps {
  model: HeroModelDisplay
  coord: SlotCoordinate
  scaleFactor: number
  isMyModel: boolean
  tooltipVisible: boolean
  onHover: (model: HeroModelDisplay, rect: DOMRect) => void
  onLeave: () => void
}

export function HeroModelHotspot({
  model,
  coord,
  scaleFactor,
  isMyModel,
  tooltipVisible,
  onHover,
  onLeave,
}: HeroModelHotspotProps): React.ReactElement {
  const style: React.CSSProperties = {
    left: coord.x / scaleFactor,
    top: coord.y / scaleFactor,
    width: coord.width / scaleFactor,
    height: coord.height / scaleFactor,
  }

  let className = 'hero-model-hotspot'

  if (isMyModel) {
    className += ' is-my-model'
  } else if (model.isGeneralTopTier) {
    className += ' shimmer-gold'
  }

  if (tooltipVisible) {
    className += ' snapshot-hidden-border'
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
    />
  )
}
