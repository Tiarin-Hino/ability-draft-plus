import { useTranslation } from 'react-i18next'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { HeroSpotDisplay, SlotCoordinate } from '@shared/types'

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

  // Hide if another hero is selected (not this one)
  if (anySelected && !isSelected) return null

  const heroBoxX = heroCoord.x / scaleFactor
  const heroBoxY = heroCoord.y / scaleFactor
  const heroBoxWidth = heroesParams.width / scaleFactor
  const heroBoxHeight = heroesParams.height / scaleFactor

  const isLeftSide = hero.heroOrder <= 4
  const MY_SPOT_MARGIN = 5

  const style: React.CSSProperties = {
    top: heroBoxY + heroBoxHeight / 2,
    transform: `translateY(-50%)${isLeftSide ? ' translateX(-100%)' : ''}`,
    left: isLeftSide
      ? heroBoxX - MY_SPOT_MARGIN
      : heroBoxX + heroBoxWidth + MY_SPOT_MARGIN,
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
