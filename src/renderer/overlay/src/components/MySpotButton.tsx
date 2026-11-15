import { useTranslation } from 'react-i18next'
import type { SlotBounds } from '@core/resolution/visual-geometry'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { HeroSpotDisplay } from '@shared/types'

const MY_SPOT_MARGIN = 6
const VIEWPORT_EDGE_MARGIN = 8
const COMPACT_EDGE_MARGIN = 4
const ESTIMATED_BUTTON_WIDTH = 74
const ESTIMATED_HALF_HEIGHT = 18
const COMPACT_GUTTER_THRESHOLD = MY_SPOT_MARGIN + ESTIMATED_BUTTON_WIDTH + VIEWPORT_EDGE_MARGIN

interface MySpotButtonProps {
  hero: HeroSpotDisplay
  resolvedBounds: SlotBounds
  viewport: { width: number; height: number }
  isSelected: boolean
  anySelected: boolean
}

export function MySpotButton({
  hero,
  resolvedBounds,
  viewport,
  isSelected,
  anySelected,
}: MySpotButtonProps): React.ReactElement | null {
  const { t } = useTranslation()
  const { onMouseEnter, onMouseLeave } = useMousePassthrough()

  // Hide if another hero is selected (not this one)
  if (anySelected && !isSelected) return null

  const heroBoxX = resolvedBounds.x
  const heroBoxY = resolvedBounds.y
  const heroBoxWidth = resolvedBounds.width
  const heroBoxHeight = resolvedBounds.height

  const isLeftSide = hero.heroOrder <= 4
  const availableGutter = isLeftSide ? heroBoxX : viewport.width - (heroBoxX + heroBoxWidth)
  const isNarrowGutter = availableGutter < COMPACT_GUTTER_THRESHOLD

  const clampedTop = Math.max(
    ESTIMATED_HALF_HEIGHT + VIEWPORT_EDGE_MARGIN,
    Math.min(
      heroBoxY + heroBoxHeight / 2,
      viewport.height - ESTIMATED_HALF_HEIGHT - VIEWPORT_EDGE_MARGIN,
    ),
  )

  let style: React.CSSProperties
  if (isNarrowGutter) {
    // 16:10 / 4:3 shrink the outer gutter below full pill width; hug the screen edge compactly.
    style = isLeftSide
      ? {
          top: clampedTop,
          left: COMPACT_EDGE_MARGIN,
          transform: 'translateY(-50%)',
        }
      : {
          top: clampedTop,
          right: COMPACT_EDGE_MARGIN,
          transform: 'translateY(-50%)',
        }
  } else {
    const rawLeft = isLeftSide
      ? heroBoxX - MY_SPOT_MARGIN
      : heroBoxX + heroBoxWidth + MY_SPOT_MARGIN
    const clampedLeft = isLeftSide
      ? Math.max(
          ESTIMATED_BUTTON_WIDTH + VIEWPORT_EDGE_MARGIN,
          Math.min(rawLeft, viewport.width - VIEWPORT_EDGE_MARGIN),
        )
      : Math.max(
          VIEWPORT_EDGE_MARGIN,
          Math.min(rawLeft, viewport.width - ESTIMATED_BUTTON_WIDTH - VIEWPORT_EDGE_MARGIN),
        )
    style = {
      top: clampedTop,
      transform: `translateY(-50%)${isLeftSide ? ' translateX(-100%)' : ''}`,
      left: clampedLeft,
    }
  }

  const handleClick = (): void => {
    window.electronApi.send('draft:selectMySpot', {
      heroOrder: hero.heroOrder,
      dbHeroId: hero.dbHeroId,
    })
  }

  const stateClass = isSelected ? 'my-spot-btn-selected' : 'my-spot-btn-unselected'
  const compactClass = isNarrowGutter ? ' my-spot-btn-compact' : ''

  return (
    <button
      className={`dynamic-btn overlay-btn my-spot-btn ${stateClass}${compactClass} overlay-interactive`}
      style={style}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isSelected ? t('changeMySpot') : t('mySpot')}
    </button>
  )
}
