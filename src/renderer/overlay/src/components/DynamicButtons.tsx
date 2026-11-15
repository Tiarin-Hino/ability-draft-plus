import { resolveVisualSlotLayout } from '@core/resolution/visual-geometry'
import type { LayoutSource, OverlayDataPayload } from '@shared/types'
import { useLogicalOverlayViewport } from '../hooks/use-logical-viewport'
import { MySpotButton } from './MySpotButton'
import { MyModelButton } from './MyModelButton'

interface DynamicButtonsProps {
  overlayData: OverlayDataPayload
  selectedSpotHeroOrder: number | null
  selectedModelHeroOrder: number | null
  layoutSource?: LayoutSource | null
}

export function DynamicButtons({
  overlayData,
  selectedSpotHeroOrder,
  selectedModelHeroOrder,
  layoutSource,
}: DynamicButtonsProps): React.ReactElement | null {
  const viewport = useLogicalOverlayViewport(
    overlayData.targetResolution,
    overlayData.scaleFactor || 1,
  )

  if (!overlayData.scanData) return null
  // Automatic draft tracking selects spot and model from GSI — the manual
  // buttons would only clutter (and fight) the automated flow
  if (overlayData.autoDraftTrackingEnabled) return null

  const { heroesForMySpotUI, heroesCoords, heroesParams, heroModels, modelsCoords, scaleFactor } =
    overlayData

  const anySpotSelected = selectedSpotHeroOrder !== null
  const anyModelSelected = selectedModelHeroOrder !== null

  return (
    <>
      {/* My Spot buttons */}
      {heroesForMySpotUI.map((hero) => {
        const heroCoord = heroesCoords.find((c) => c.hero_order === hero.heroOrder)
        if (!heroCoord) return null
        const visualCard = resolveVisualSlotLayout({
          fallback: {
            x: heroCoord.x / scaleFactor,
            y: heroCoord.y / scaleFactor,
            width: (heroCoord.width || heroesParams.width) / scaleFactor,
            height: (heroCoord.height || heroesParams.height) / scaleFactor,
          },
          category: 'heroCard',
          heroOrder: hero.heroOrder,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          layoutSource,
        })
        return (
          <MySpotButton
            key={`spot-${hero.heroOrder}`}
            hero={hero}
            resolvedBounds={visualCard.bounds}
            viewport={viewport}
            isSelected={hero.heroOrder === selectedSpotHeroOrder}
            anySelected={anySpotSelected}
          />
        )
      })}

      {/* My Model buttons */}
      {heroModels.map((model) => {
        const coord = modelsCoords.find((c) => c.hero_order === model.heroOrder)
        if (!coord) return null
        const visualModel = resolveVisualSlotLayout({
          fallback: {
            x: coord.x / scaleFactor,
            y: coord.y / scaleFactor,
            width: coord.width / scaleFactor,
            height: coord.height / scaleFactor,
          },
          category: 'model',
          heroOrder: model.heroOrder,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          layoutSource,
        })
        return (
          <MyModelButton
            key={`model-${model.heroOrder}`}
            model={model}
            resolvedBounds={visualModel.bounds}
            horizontalOverhangPx={visualModel.horizontalOverhangPx}
            viewport={viewport}
            isSelected={model.heroOrder === selectedModelHeroOrder}
            anySelected={anyModelSelected}
          />
        )
      })}
    </>
  )
}
