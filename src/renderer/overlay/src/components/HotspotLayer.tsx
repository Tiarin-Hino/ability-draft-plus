import { useState, useCallback, useEffect, useMemo } from 'react'
import { computeBoardPerspectiveStyle, type VisualSlotCategory } from '@core/resolution'
import type {
  EnrichedScanSlot,
  HeroModelDisplay,
  OverlayDataPayload,
  SlotCoordinate,
} from '@shared/types'
import { AbilityHotspot } from './AbilityHotspot'
import { HeroModelHotspot } from './HeroModelHotspot'
import { Tooltip, type TooltipData } from './Tooltip'

const MAX_RANK_BADGES = 10

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

  const scanData = overlayData.scanData
  const topRankMap = useMemo(() => {
    const map = new Map<EnrichedScanSlot, number>()
    if (!scanData) return map
    const ranked = [...scanData.ultimates, ...scanData.standard]
      .filter(
        (slot) =>
          !slot.isUnknown &&
          slot.name !== null &&
          slot.name !== 'Unknown' &&
          (slot.isGeneralTopTier || slot.isSynergySuggestionForMySpot),
      )
      .sort((a, b) => (b.consolidatedScore ?? -1) - (a.consolidatedScore ?? -1))
      .slice(0, MAX_RANK_BADGES)
    ranked.forEach((slot, index) => {
      map.set(slot, index + 1)
    })
    return map
  }, [scanData])

  const handleAbilityHover = useCallback((slot: EnrichedScanSlot, rect: DOMRect) => {
    setTooltipData({ type: 'ability', slot })
    setTooltipAnchor(rect)
  }, [])

  const handleHeroHover = useCallback((model: HeroModelDisplay, rect: DOMRect) => {
    setTooltipData({ type: 'hero', model })
    setTooltipAnchor(rect)
  }, [])

  const handleLeave = useCallback(() => {
    setTooltipData(null)
    setTooltipAnchor(null)
  }, [])

  if (!scanData) return null

  const { scaleFactor, heroModels, modelsCoords } = overlayData

  const getPerspectiveTransform = (
    coord: SlotCoordinate,
    category: VisualSlotCategory,
  ): string | undefined => {
    const { cssTransform } = computeBoardPerspectiveStyle(
      {
        x: coord.x / scaleFactor,
        y: coord.y / scaleFactor,
        width: coord.width / scaleFactor,
        height: coord.height / scaleFactor,
      },
      category,
      viewport.width,
      viewport.height,
    )
    return cssTransform !== 'none' ? cssTransform : undefined
  }

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
          topRank={topRankMap.get(slot)}
          perspectiveTransform={getPerspectiveTransform(slot.coord, 'ultimate')}
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
          topRank={topRankMap.get(slot)}
          perspectiveTransform={getPerspectiveTransform(slot.coord, 'standard')}
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
          perspectiveTransform={getPerspectiveTransform(slot.coord, 'selected')}
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
            perspectiveTransform={getPerspectiveTransform(coord, 'model')}
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
