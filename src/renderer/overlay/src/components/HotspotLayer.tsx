import { useState, useCallback } from 'react'
import type { EnrichedScanSlot, HeroModelDisplay, OverlayDataPayload } from '@shared/types'
import { AbilityHotspot } from './AbilityHotspot'
import { HeroModelHotspot } from './HeroModelHotspot'
import { Tooltip, type TooltipData } from './Tooltip'

interface HotspotLayerProps {
  overlayData: OverlayDataPayload
  selectedSpotHeroOrder: number | null
  selectedModelHeroOrder: number | null
}

export function HotspotLayer({
  overlayData,
  selectedSpotHeroOrder,
  selectedModelHeroOrder,
}: HotspotLayerProps): React.ReactElement | null {
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null)
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null)

  const tooltipVisible = tooltipData !== null

  const handleAbilityHover = useCallback(
    (slot: EnrichedScanSlot, rect: DOMRect) => {
      setTooltipData({ type: 'ability', slot })
      setTooltipAnchor(rect)
    },
    [],
  )

  const handleHeroHover = useCallback(
    (model: HeroModelDisplay, rect: DOMRect) => {
      setTooltipData({ type: 'hero', model })
      setTooltipAnchor(rect)
    },
    [],
  )

  const handleLeave = useCallback(() => {
    setTooltipData(null)
    setTooltipAnchor(null)
  }, [])

  if (!overlayData.scanData) return null

  const { scanData, scaleFactor, heroModels, modelsCoords } = overlayData

  return (
    <>
      {/* Ultimate ability hotspots */}
      {scanData.ultimates.map((slot, i) => (
        <AbilityHotspot
          key={`ult-${i}`}
          slot={slot}
          scaleFactor={scaleFactor}
          isSelectedAbility={false}
          isMySpotHero={false}
          tooltipVisible={tooltipVisible}
          onHover={handleAbilityHover}
          onLeave={handleLeave}
        />
      ))}

      {/* Standard ability hotspots */}
      {scanData.standard.map((slot, i) => (
        <AbilityHotspot
          key={`std-${i}`}
          slot={slot}
          scaleFactor={scaleFactor}
          isSelectedAbility={false}
          isMySpotHero={false}
          tooltipVisible={tooltipVisible}
          onHover={handleAbilityHover}
          onLeave={handleLeave}
        />
      ))}

      {/* Selected (picked) ability hotspots */}
      {scanData.selectedAbilities.map((slot, i) => (
        <AbilityHotspot
          key={`sel-${i}`}
          slot={slot}
          scaleFactor={scaleFactor}
          isSelectedAbility
          isMySpotHero={slot.hero_order === selectedSpotHeroOrder}
          tooltipVisible={tooltipVisible}
          onHover={handleAbilityHover}
          onLeave={handleLeave}
        />
      ))}

      {/* Hero model hotspots */}
      {heroModels.map((model) => {
        const coord = modelsCoords.find((c) => c.hero_order === model.heroOrder)
        if (!coord) return null
        return (
          <HeroModelHotspot
            key={`hero-${model.heroOrder}`}
            model={model}
            coord={coord}
            scaleFactor={scaleFactor}
            isMyModel={model.heroOrder === selectedModelHeroOrder}
            tooltipVisible={tooltipVisible}
            onHover={handleHeroHover}
            onLeave={handleLeave}
          />
        )
      })}

      {/* Singleton Tooltip */}
      <Tooltip data={tooltipData} anchorRect={tooltipAnchor} />
    </>
  )
}
