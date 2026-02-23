import { useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { EnrichedScanSlot, HeroModelDisplay, SynergyPairDisplay, HeroSynergyDisplay } from '@shared/types'

export type TooltipData =
  | { type: 'ability'; slot: EnrichedScanSlot }
  | { type: 'hero'; model: HeroModelDisplay }

interface TooltipProps {
  data: TooltipData | null
  anchorRect: DOMRect | null
}

const MARGIN = 10
const MAX_SYNERGIES = 5

function formatWinrate(value: number | null): string {
  if (value === null) return 'N/A'
  return `${(value * 100).toFixed(1)}%`
}

function formatPickRate(value: number | null): string {
  if (value === null) return 'N/A'
  return value.toFixed(2)
}

function formatSynergyWr(wr: number): string {
  return `${(wr * 100).toFixed(1)}%`
}

function positionTooltip(el: HTMLDivElement, anchorRect: DOMRect): void {
  const tooltipWidth = el.offsetWidth
  const tooltipHeight = el.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight

  // Prefer left of anchor
  let x = anchorRect.left - tooltipWidth - MARGIN
  if (x < MARGIN) {
    // Try right of anchor
    x = anchorRect.right + MARGIN
    if (x + tooltipWidth > vw - MARGIN) {
      x = vw - tooltipWidth - MARGIN
    }
  }
  if (x < MARGIN) x = MARGIN

  // Y starts at anchor top, clamped to viewport
  let y = anchorRect.top
  if (y + tooltipHeight > vh - MARGIN) {
    y = vh - tooltipHeight - MARGIN
  }
  if (y < MARGIN) y = MARGIN

  el.style.left = `${x}px`
  el.style.top = `${y}px`
}

export function Tooltip({ data, anchorRect }: TooltipProps): React.ReactElement | null {
  const { t } = useTranslation()
  const prevAnchorRef = useRef<DOMRect | null>(null)

  // Use callback ref to position immediately when DOM mounts/updates
  const tooltipCallbackRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && anchorRect) {
        positionTooltip(el, anchorRect)
        prevAnchorRef.current = anchorRect
      }
    },
    [anchorRect],
  )

  if (!data) return null

  return (
    <div
      ref={tooltipCallbackRef}
      className="overlay-tooltip"
      role="tooltip"
      id="overlay-tooltip"
      style={{ left: -9999, top: -9999 }}
    >
      {data.type === 'ability' ? (
        <AbilityTooltipContent slot={data.slot} t={t} />
      ) : (
        <HeroTooltipContent model={data.model} t={t} />
      )}
    </div>
  )
}

function AbilityTooltipContent({
  slot,
  t,
}: {
  slot: EnrichedScanSlot
  t: (key: string, opts?: Record<string, string>) => string
}): React.ReactElement {
  return (
    <>
      {/* Badges */}
      {slot.isSynergySuggestionForMySpot && (
        <div className="tooltip-badge tooltip-badge-synergy">
          &#x2726; {t('tooltip.synergyPick')}
        </div>
      )}
      {slot.isGeneralTopTier && !slot.isSynergySuggestionForMySpot && (
        <div className="tooltip-badge tooltip-badge-top">
          &#x2605; {t('tooltip.topPick')}
        </div>
      )}

      <div className="tooltip-title">{slot.displayName}</div>
      <div className="tooltip-stat">
        {t('tooltip.winrate', { value: formatWinrate(slot.winrate) })}
      </div>
      <div className="tooltip-stat">
        {t('tooltip.pickRate', { value: formatPickRate(slot.pickRate) })}
      </div>

      <SynergySection
        title={t('tooltip.strongSynergies')}
        items={slot.highWinrateCombinations}
        renderItem={renderAbilitySynergy}
      />
      <HeroSynergySection
        title={t('tooltip.heroSynergies')}
        items={slot.strongHeroSynergies}
        displayField="heroDisplayName"
      />
      <SynergySection
        title={t('tooltip.weakSynergies')}
        items={slot.lowWinrateCombinations}
        renderItem={renderWeakAbilitySynergy}
      />
      <HeroSynergySection
        title={t('tooltip.weakHeroSynergies')}
        items={slot.weakHeroSynergies}
        weak
        displayField="heroDisplayName"
      />
    </>
  )
}

function HeroTooltipContent({
  model,
  t,
}: {
  model: HeroModelDisplay
  t: (key: string, opts?: Record<string, string>) => string
}): React.ReactElement {
  return (
    <>
      {model.isGeneralTopTier && (
        <div className="tooltip-badge tooltip-badge-model">
          &#x2605; {t('tooltip.topModel')}
        </div>
      )}

      <div className="tooltip-title">{model.heroDisplayName}</div>
      <div className="tooltip-stat">
        {t('tooltip.winrate', { value: formatWinrate(model.winrate) })}
      </div>
      <div className="tooltip-stat">
        {t('tooltip.pickRate', { value: formatPickRate(model.pickRate) })}
      </div>

      <HeroSynergySection
        title={t('tooltip.strongAbilities')}
        items={model.strongAbilitySynergies}
      />
      <HeroSynergySection
        title={t('tooltip.weakAbilities')}
        items={model.weakAbilitySynergies}
        weak
      />
    </>
  )
}

function SynergySection({
  title,
  items,
  renderItem,
}: {
  title: string
  items: SynergyPairDisplay[]
  renderItem: (item: SynergyPairDisplay, index: number) => React.ReactElement
}): React.ReactElement | null {
  if (items.length === 0) return null
  return (
    <>
      <div className="tooltip-section-title">{title}</div>
      {items.slice(0, MAX_SYNERGIES).map(renderItem)}
    </>
  )
}

function HeroSynergySection({
  title,
  items,
  weak,
  displayField = 'abilityDisplayName',
}: {
  title: string
  items: HeroSynergyDisplay[]
  weak?: boolean
  displayField?: 'abilityDisplayName' | 'heroDisplayName'
}): React.ReactElement | null {
  if (items.length === 0) return null
  return (
    <>
      <div className="tooltip-section-title">{title}</div>
      {items.slice(0, MAX_SYNERGIES).map((item, i) => (
        <div
          key={i}
          className={`tooltip-combo tooltip-combo-hero${weak ? ' tooltip-combo-weak' : ''}`}
        >
          - {item[displayField]}{' '}
          <span className={weak ? 'tooltip-combo-weak' : 'tooltip-combo-winrate'}>
            ({formatSynergyWr(item.synergyWinrate)} WR)
          </span>
        </div>
      ))}
    </>
  )
}

function renderAbilitySynergy(item: SynergyPairDisplay, i: number): React.ReactElement {
  return (
    <div key={i} className="tooltip-combo">
      - {item.ability2DisplayName}{' '}
      <span className="tooltip-combo-winrate">
        ({formatSynergyWr(item.synergyWinrate)} WR)
      </span>
    </div>
  )
}

function renderWeakAbilitySynergy(item: SynergyPairDisplay, i: number): React.ReactElement {
  return (
    <div key={i} className="tooltip-combo tooltip-combo-weak">
      - {item.ability2DisplayName}{' '}
      <span className="tooltip-combo-weak">
        ({formatSynergyWr(item.synergyWinrate)} WR)
      </span>
    </div>
  )
}
