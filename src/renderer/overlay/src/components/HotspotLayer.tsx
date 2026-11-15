import { useState, useCallback, useMemo } from 'react'
import {
  resolveVisualSlotLayout,
  type ResolvedVisualSlot,
  type VisualSlotCategory,
} from '@core/resolution/visual-geometry'
import type {
  EnrichedScanSlot,
  HeroModelDisplay,
  LayoutSource,
  OverlayDataPayload,
  SlotCoordinate,
} from '@shared/types'
import { useLogicalOverlayViewport } from '../hooks/use-logical-viewport'
import { AbilityHotspot } from './AbilityHotspot'
import { HeroModelHotspot } from './HeroModelHotspot'
import { Tooltip, type TooltipData } from './Tooltip'

const MAX_RANK_BADGES = 10

interface HotspotLayerProps {
  overlayData: OverlayDataPayload
  selectedSpotHeroOrder: number | null
  selectedModelHeroOrder: number | null
  layoutSource?: LayoutSource | null
}

export function HotspotLayer({
  overlayData,
  selectedSpotHeroOrder,
  selectedModelHeroOrder,
  layoutSource,
}: HotspotLayerProps): React.ReactElement | null {
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null)
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null)
  const viewport = useLogicalOverlayViewport(
    overlayData.targetResolution,
    overlayData.scaleFactor || 1,
  )

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

  const buildResolvedSlot = (
    coord: SlotCoordinate,
    category: VisualSlotCategory,
    heroOrder?: number,
    abilityOrder?: number,
    isUltimate?: boolean,
    boxIndex?: number,
  ): ResolvedVisualSlot =>
    resolveVisualSlotLayout({
      fallback: {
        x: coord.x / scaleFactor,
        y: coord.y / scaleFactor,
        width: coord.width / scaleFactor,
        height: coord.height / scaleFactor,
      },
      category,
      heroOrder: heroOrder ?? coord.hero_order,
      abilityOrder: abilityOrder ?? coord.ability_order,
      isUltimate: isUltimate ?? coord.is_ultimate,
      boxIndex,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      layoutSource,
    })

  const resolveEnrichedSlot = (
    slot: EnrichedScanSlot,
    category: 'ultimate' | 'standard' | 'selected',
    boxIndex?: number,
  ): ResolvedVisualSlot =>
    buildResolvedSlot(
      slot.coord,
      category,
      slot.hero_order ?? slot.coord.hero_order,
      slot.ability_order > 0 ? slot.ability_order : slot.coord.ability_order,
      slot.is_ultimate || slot.coord.is_ultimate,
      boxIndex,
    )

  const selectedBoxCounts = new Map<number, number>()

  return (
    <>
      {/* Ultimate ability hotspots */}
      {scanData.ultimates.map((slot, i) => {
        const visual = resolveEnrichedSlot(slot, 'ultimate')
        return (
          <AbilityHotspot
            key={`ult-${i}`}
            slot={slot}
            scaleFactor={scaleFactor}
            resolvedBounds={visual.bounds}
            slotCategory="ultimate"
            isSelectedAbility={false}
            isMySpotHero={false}
            topRank={topRankMap.get(slot)}
            perspectiveTransform={
              visual.perspective.cssTransform !== 'none'
                ? visual.perspective.cssTransform
                : undefined
            }
            onHover={handleAbilityHover}
            onLeave={handleLeave}
          />
        )
      })}

      {/* Standard ability hotspots */}
      {scanData.standard.map((slot, i) => {
        const visual = resolveEnrichedSlot(slot, 'standard')
        return (
          <AbilityHotspot
            key={`std-${i}`}
            slot={slot}
            scaleFactor={scaleFactor}
            resolvedBounds={visual.bounds}
            slotCategory="standard"
            isSelectedAbility={false}
            isMySpotHero={false}
            topRank={topRankMap.get(slot)}
            perspectiveTransform={
              visual.perspective.cssTransform !== 'none'
                ? visual.perspective.cssTransform
                : undefined
            }
            onHover={handleAbilityHover}
            onLeave={handleLeave}
          />
        )
      })}

      {/* Selected (picked) ability hotspots */}
      {scanData.selectedAbilities.map((slot, i) => {
        const boxIndex = selectedBoxCounts.get(slot.hero_order) ?? 0
        selectedBoxCounts.set(slot.hero_order, boxIndex + 1)
        const visual = resolveEnrichedSlot(slot, 'selected', boxIndex)
        return (
          <AbilityHotspot
            key={`sel-${i}`}
            slot={slot}
            scaleFactor={scaleFactor}
            resolvedBounds={visual.bounds}
            slotCategory="selected"
            isSelectedAbility
            isMySpotHero={slot.hero_order === selectedSpotHeroOrder}
            perspectiveTransform={
              visual.perspective.cssTransform !== 'none'
                ? visual.perspective.cssTransform
                : undefined
            }
            onHover={handleAbilityHover}
            onLeave={handleLeave}
          />
        )
      })}

      {/* Hero model hotspots */}
      {heroModels.map((model) => {
        const coord = modelsCoords.find((c) => c.hero_order === model.heroOrder)
        if (!coord) return null
        const visual = buildResolvedSlot(coord, 'model', model.heroOrder)
        return (
          <HeroModelHotspot
            key={`hero-${model.heroOrder}`}
            model={model}
            coord={coord}
            scaleFactor={scaleFactor}
            resolvedBounds={visual.bounds}
            isMyModel={model.heroOrder === selectedModelHeroOrder}
            perspectiveTransform={
              visual.perspective.cssTransform !== 'none'
                ? visual.perspective.cssTransform
                : undefined
            }
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
