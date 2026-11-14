import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { HeroModelDisplay, SlotCoordinate } from '@shared/types'

const MY_MODEL_MARGIN = 4
const VIEWPORT_EDGE_MARGIN = 8
const ESTIMATED_BUTTON_WIDTH = 66
const ESTIMATED_HALF_HEIGHT = 16

interface MyModelButtonProps {
  model: HeroModelDisplay
  coord: SlotCoordinate
  scaleFactor: number
  isSelected: boolean
  anySelected: boolean
}

export function MyModelButton({
  model,
  coord,
  scaleFactor,
  isSelected,
  anySelected,
}: MyModelButtonProps): React.ReactElement | null {
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

  // Hide if another model is selected (not this one)
  if (anySelected && !isSelected) return null

  // Can't select models with no DB entry
  if (model.dbHeroId === null) return null

  const isLeftSide = model.heroOrder <= 4 || model.heroOrder === 10

  const boxX = coord.x / scaleFactor
  const boxY = coord.y / scaleFactor
  const boxWidth = coord.width / scaleFactor
  const boxHeight = coord.height / scaleFactor

  const rawLeft = isLeftSide ? boxX - MY_MODEL_MARGIN : boxX + boxWidth + MY_MODEL_MARGIN
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
    Math.min(boxY + boxHeight / 2, viewport.height - ESTIMATED_HALF_HEIGHT - VIEWPORT_EDGE_MARGIN),
  )

  const style: React.CSSProperties = {
    top: clampedTop,
    transform: `translateY(-50%)${isLeftSide ? ' translateX(-100%)' : ''}`,
    left: clampedLeft,
  }

  const handleClick = (): void => {
    window.electronApi.send('draft:selectMyModel', {
      heroOrder: model.heroOrder,
      dbHeroId: model.dbHeroId!,
    })
  }

  const stateClass = isSelected ? 'my-model-btn-selected' : 'my-model-btn-unselected'

  return (
    <button
      className={`dynamic-btn overlay-btn my-model-btn ${stateClass} overlay-interactive`}
      style={style}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isSelected ? t('changeMyModel') : t('myModel')}
    </button>
  )
}
