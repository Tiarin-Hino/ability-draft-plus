import { useTranslation } from 'react-i18next'
import type { SlotBounds } from '@core/resolution/visual-geometry'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { HeroModelDisplay } from '@shared/types'

const VIEWPORT_EDGE_MARGIN = 8
const ESTIMATED_BUTTON_WIDTH = 66
const ESTIMATED_HALF_HEIGHT = 16

interface MyModelButtonProps {
  model: HeroModelDisplay
  resolvedBounds: SlotBounds
  horizontalOverhangPx: number
  viewport: { width: number; height: number }
  isSelected: boolean
  anySelected: boolean
}

export function MyModelButton({
  model,
  resolvedBounds,
  horizontalOverhangPx,
  viewport,
  isSelected,
  anySelected,
}: MyModelButtonProps): React.ReactElement | null {
  const { t } = useTranslation()
  const isVisible = !(anySelected && !isSelected) && model.dbHeroId !== null
  const { onMouseEnter, onMouseLeave } = useMousePassthrough(isVisible)

  // Hide if another model is selected (not this one) or model has no DB entry
  if (!isVisible) return null

  const isLeftSide = model.heroOrder <= 4 || model.heroOrder === 10

  const boxX = resolvedBounds.x - horizontalOverhangPx
  const boxY = resolvedBounds.y
  const boxWidth = resolvedBounds.width + horizontalOverhangPx * 2
  const boxHeight = resolvedBounds.height

  const pedestalMargin = Math.max(8, Math.round(resolvedBounds.width * 0.19))
  const rawLeft = isLeftSide ? boxX - pedestalMargin : boxX + boxWidth + pedestalMargin
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
