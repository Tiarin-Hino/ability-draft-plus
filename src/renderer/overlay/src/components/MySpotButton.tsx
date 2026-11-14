import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { HeroSpotDisplay, SlotCoordinate } from '@shared/types'

const MY_SPOT_MARGIN = 6
const VIEWPORT_EDGE_MARGIN = 8
const ESTIMATED_BUTTON_WIDTH = 74
const ESTIMATED_HALF_HEIGHT = 18

interface MySpotButtonProps {
  hero: HeroSpotDisplay
  heroCoord: SlotCoordinate
  heroesParams: { width: number; height: number }
  scaleFactor: number
  isSelected: boolean
  anySelected: boolean
}

export function MySpotButton({
  hero,
  heroCoord,
  heroesParams,
  scaleFactor,
  isSelected,
  anySelected,
}: MySpotButtonProps): React.ReactElement | null {
  const { t } = useTranslation()
  const { onMouseEnter, onMouseLeave } = useMousePassthrough()
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }))

  useEffect(() => {
    const onResize = (): void => {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Hide if another hero is selected (not this one)
  if (anySelected && !isSelected) return null

  const heroBoxX = heroCoord.x / scaleFactor
  const heroBoxY = heroCoord.y / scaleFactor
  const heroBoxWidth = heroesParams.width / scaleFactor
  const heroBoxHeight = heroesParams.height / scaleFactor

  const isLeftSide = hero.heroOrder <= 4
  const rawLeft = isLeftSide ? heroBoxX - MY_SPOT_MARGIN : heroBoxX + heroBoxWidth + MY_SPOT_MARGIN
  const clampedLeft = isLeftSide
    ? Math.max(
        ESTIMATED_BUTTON_WIDTH + VIEWPORT_EDGE_MARGIN,
        Math.min(rawLeft, viewport.width - VIEWPORT_EDGE_MARGIN),
      )
    : Math.max(
        VIEWPORT_EDGE_MARGIN,
        Math.min(rawLeft, viewport.width - ESTIMATED_BUTTON_WIDTH - VIEWPORT_EDGE_MARGIN),
      )
  const clampedTop = Math.max(
    ESTIMATED_HALF_HEIGHT + VIEWPORT_EDGE_MARGIN,
    Math.min(
      heroBoxY + heroBoxHeight / 2,
      viewport.height - ESTIMATED_HALF_HEIGHT - VIEWPORT_EDGE_MARGIN,
    ),
  )

  const style: React.CSSProperties = {
    top: clampedTop,
    transform: `translateY(-50%)${isLeftSide ? ' translateX(-100%)' : ''}`,
    left: clampedLeft,
  }

  const handleClick = (): void => {
    window.electronApi.send('draft:selectMySpot', {
      heroOrder: hero.heroOrder,
      dbHeroId: hero.dbHeroId,
    })
  }

  const stateClass = isSelected ? 'my-spot-btn-selected' : 'my-spot-btn-unselected'

  return (
    <button
      className={`dynamic-btn overlay-btn my-spot-btn ${stateClass} overlay-interactive`}
      style={style}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isSelected ? t('changeMySpot') : t('mySpot')}
    </button>
  )
}
