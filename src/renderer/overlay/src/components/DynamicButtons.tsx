import type { OverlayDataPayload } from '@shared/types'
import { MySpotButton } from './MySpotButton'
import { MyModelButton } from './MyModelButton'

interface DynamicButtonsProps {
  overlayData: OverlayDataPayload
  selectedSpotHeroOrder: number | null
  selectedModelHeroOrder: number | null
}

export function DynamicButtons({
  overlayData,
  selectedSpotHeroOrder,
  selectedModelHeroOrder,
}: DynamicButtonsProps): React.ReactElement | null {
  if (!overlayData.scanData) return null

  const {
    heroesForMySpotUI,
    heroesCoords,
    heroesParams,
    heroModels,
    modelsCoords,
    scaleFactor,
  } = overlayData

  const anySpotSelected = selectedSpotHeroOrder !== null
  const anyModelSelected = selectedModelHeroOrder !== null

  return (
    <>
      {/* My Spot buttons */}
      {heroesForMySpotUI.map((hero) => {
        const heroCoord = heroesCoords.find((c) => c.hero_order === hero.heroOrder)
        if (!heroCoord) return null
        return (
          <MySpotButton
            key={`spot-${hero.heroOrder}`}
            hero={hero}
            heroCoord={heroCoord}
            heroesParams={heroesParams}
            scaleFactor={scaleFactor}
            isSelected={hero.heroOrder === selectedSpotHeroOrder}
            anySelected={anySpotSelected}
          />
        )
      })}

      {/* My Model buttons */}
      {heroModels.map((model) => {
        const coord = modelsCoords.find((c) => c.hero_order === model.heroOrder)
        if (!coord) return null
        return (
          <MyModelButton
            key={`model-${model.heroOrder}`}
            model={model}
            coord={coord}
            scaleFactor={scaleFactor}
            isSelected={model.heroOrder === selectedModelHeroOrder}
            anySelected={anyModelSelected}
          />
        )
      })}
    </>
  )
}
