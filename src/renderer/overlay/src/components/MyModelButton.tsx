import { useTranslation } from 'react-i18next'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { HeroModelDisplay, SlotCoordinate } from '@shared/types'

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

  // Hide if another model is selected (not this one)
  if (anySelected && !isSelected) return null

  // Can't select models with no DB entry
  if (model.dbHeroId === null) return null

  const MY_MODEL_MARGIN = 3
  const isLeftSide = model.heroOrder <= 4 || model.heroOrder === 10

  const boxX = coord.x / scaleFactor
  const boxY = coord.y / scaleFactor
  const boxWidth = coord.width / scaleFactor
  const boxHeight = coord.height / scaleFactor

  const style: React.CSSProperties = {
    top: boxY + boxHeight / 2,
    transform: `translateY(-50%)${isLeftSide ? ' translateX(-100%)' : ''}`,
    left: isLeftSide
      ? boxX - MY_MODEL_MARGIN
      : boxX + boxWidth + MY_MODEL_MARGIN,
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
