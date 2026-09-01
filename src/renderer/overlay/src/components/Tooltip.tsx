import { useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { EnrichedScanSlot, HeroModelDisplay, SynergyPairDisplay, HeroSynergyDisplay } from '@shared/types'
import {
  PERSONAL_SCORE_DELTA_EPSILON,
  ROLE_SCORE_DELTA_EPSILON,
} from '@shared/constants/thresholds'

export type TooltipData =
  | { type: 'ability'; slot: EnrichedScanSlot }
  | { type: 'hero'; model: HeroModelDisplay }

interface TooltipProps {
  data: TooltipData | null
  anchorRect: DOMRect | null
}

const MARGIN = 10
const MAX_SYNERGIES = 5

// Coerced defensively — v1-era databases can hold text-typed numerics (#77)
function formatWinrate(value: number | null): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (value == null || Number.isNaN(n)) return 'N/A'
  return `${(n * 100).toFixed(1)}%`
}

function formatPickRate(value: number | null): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (value == null || Number.isNaN(n)) return 'N/A'
  return n.toFixed(2)
}

function formatSynergyWr(wr: number): string {
  const n = typeof wr === 'number' ? wr : Number(wr)
  if (Number.isNaN(n)) return 'N/A'
  return `${(n * 100).toFixed(1)}%`
}

// Personal (linked Windrun profile) stat line, shared by ability and hero
// tooltips. The arrow marks whether personalization moved the score up or down
// vs the global-only ranking; negligible shifts render no arrow.
function PersonalStatLine({
  games,
  winrate,
  scoreDelta,
  t,
}: {
  games?: number
  winrate?: number
  scoreDelta?: number
  t: (key: string, opts?: Record<string, string>) => string
}): React.ReactElement | null {
  if (games == null || winrate == null) return null

  const delta = scoreDelta ?? 0
  const arrow =
    delta > PERSONAL_SCORE_DELTA_EPSILON
      ? '▲'
      : delta < -PERSONAL_SCORE_DELTA_EPSILON
        ? '▼'
        : null
  const arrowClass =
    delta > PERSONAL_SCORE_DELTA_EPSILON
      ? 'tooltip-personal-up'
      : 'tooltip-personal-down'

  return (
    <div className="tooltip-stat tooltip-personal">
      {t('tooltip.personalStats', {
        value: formatWinrate(winrate),
        games: String(games),
      })}
      {arrow && <span className={arrowClass}> {arrow}</span>}
    </div>
  )
}

// Role-fit line (role-aware suggestions): which effective position this ability
// fits best and whether the role layer moved its score up or down. Negligible
// shifts render nothing — same anti-noise rule as the personal line.
function RoleStatLine({
  scoreDelta,
  position,
  t,
}: {
  scoreDelta?: number
  position?: number
  t: (key: string, opts?: Record<string, string>) => string
}): React.ReactElement | null {
  if (scoreDelta == null || position == null) return null
  if (Math.abs(scoreDelta) <= ROLE_SCORE_DELTA_EPSILON) return null

  const up = scoreDelta > 0
  return (
    <div className="tooltip-stat tooltip-role">
      {t('tooltip.roleFit', { position: String(position) })}
      <span className={up ? 'tooltip-role-up' : 'tooltip-role-down'}>
        {' '}
        {up ? '▲' : '▼'}
      </span>
    </div>
  )
}

// Layer C pairing line: how the picked model's chassis moved this ability (or
// how the user's drafted abilities moved this model). Same anti-noise epsilon.
function PairingStatLine({
  scoreDelta,
  t,
}: {
  scoreDelta?: number
  t: (key: string, opts?: Record<string, string>) => string
}): React.ReactElement | null {
  if (scoreDelta == null) return null
  if (Math.abs(scoreDelta) <= ROLE_SCORE_DELTA_EPSILON) return null

  const up = scoreDelta > 0
  return (
    <div className="tooltip-stat tooltip-role">
      {t('tooltip.pairingFit')}
      <span className={up ? 'tooltip-role-up' : 'tooltip-role-down'}>
        {' '}
        {up ? '▲' : '▼'}
      </span>
    </div>
  )
}

// Needs-engine reason chips ('covers:<need>' / 'duplicate:<need>' / 'curated')
// — the explainability half of the tags feature: WHY the role layer moved this.
function RoleReasonChips({
  reasons,
  t,
}: {
  reasons?: string[]
  t: (key: string, opts?: Record<string, string>) => string
}): React.ReactElement | null {
  if (!reasons || reasons.length === 0) return null
  return (
    <div className="tooltip-role-chips">
      {reasons.map((reason) => {
        const [kind, key, via] = reason.split(':')
        if (kind === 'curated') {
          return (
            <span key={reason} className="tooltip-role-chip tooltip-role-chip-curated">
              {t('tooltip.roleCurated')}
            </span>
          )
        }
        // Full-credit alternative match: the chip names the MATCHED tag, not
        // the need it satisfied ("Covers your missing nuke" — Shadow Realm
        // ruling). Partial credit says so explicitly and keeps the need name.
        const need = t(`tooltip.roleNeeds.${via ?? key}`)
        return (
          <span
            key={reason}
            className={`tooltip-role-chip${kind === 'duplicate' ? ' tooltip-role-chip-dup' : ''}`}
          >
            {kind === 'duplicate'
              ? t('tooltip.roleDuplicate', { need })
              : kind === 'partial'
                ? t('tooltip.rolePartial', { need: t(`tooltip.roleNeeds.${key}`) })
                : t('tooltip.roleCovers', { need })}
          </span>
        )
      })}
    </div>
  )
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
  if (slot.isUnknown) {
    return (
      <>
        <div className="tooltip-title">{t('tooltip.unknownAbility')}</div>
        <div className="tooltip-stat">{t('tooltip.unknownHint')}</div>
      </>
    )
  }

  return (
    <>
      {/* Badges */}
      {slot.isSynergySuggestionForMySpot && (
        <div className="tooltip-badge tooltip-badge-synergy">
          &#x2726; {t('tooltip.synergyPick')}
        </div>
      )}
      {slot.isGeneralTopTier &&
        !slot.isSynergySuggestionForMySpot &&
        (slot.isCuratedForRole ? (
          <div className="tooltip-badge tooltip-badge-curated">
            &#x2726; {t('tooltip.curatedPick')}
          </div>
        ) : slot.isPersonallyDriven ? (
          <div className="tooltip-badge tooltip-badge-personal">
            &#x2605; {t('tooltip.personalPick')}
          </div>
        ) : (
          <div className="tooltip-badge tooltip-badge-top">
            &#x2605; {t('tooltip.topPick')}
          </div>
        ))}

      <div className="tooltip-title">{slot.displayName}</div>
      <div className="tooltip-stat">
        {t('tooltip.winrate', { value: formatWinrate(slot.winrate) })}
      </div>
      <div className="tooltip-stat">
        {t('tooltip.pickRate', { value: formatPickRate(slot.pickRate) })}
      </div>
      <PersonalStatLine
        games={slot.personalGames}
        winrate={slot.personalWinrate}
        scoreDelta={slot.personalScoreDelta}
        t={t}
      />
      <RoleStatLine
        scoreDelta={slot.roleScoreDelta}
        position={slot.roleBestPosition}
        t={t}
      />
      <RoleReasonChips reasons={slot.roleReasons} t={t} />
      <PairingStatLine scoreDelta={slot.pairingScoreDelta} t={t} />
      {slot.inertOnModel && (
        <div className="tooltip-stat tooltip-inert">{t('tooltip.inertOnModel')}</div>
      )}
      {slot.unmetRequirement && (
        <div className="tooltip-stat tooltip-inert">
          {t(
            slot.unmetRequirement.kind === 'model'
              ? 'tooltip.requiresModel'
              : slot.unmetRequirement.kind === 'tag'
                ? 'tooltip.requiresTag'
                : 'tooltip.requiresAbility',
            { name: slot.unmetRequirement.displayName },
          )}
        </div>
      )}
      {slot.roleAvoided && (
        <div className="tooltip-stat tooltip-inert">{t('tooltip.roleAvoided')}</div>
      )}
      {slot.overrated && (
        <div className="tooltip-stat tooltip-inert">
          {t('tooltip.overrated', { value: formatWinrate(slot.winrate) })}
        </div>
      )}
      {slot.contestedSoon &&
        (slot.isGeneralTopTier || slot.isSynergySuggestionForMySpot) && (
          <div className="tooltip-stat tooltip-contested">
            {t('tooltip.contestedSoon')}
          </div>
        )}

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
      {model.isGeneralTopTier &&
        (model.isCuratedForRole ? (
          <div className="tooltip-badge tooltip-badge-curated">
            &#x2726; {t('tooltip.curatedPick')}
          </div>
        ) : model.isPersonallyDriven ? (
          <div className="tooltip-badge tooltip-badge-personal">
            &#x2605; {t('tooltip.personalPick')}
          </div>
        ) : (
          <div className="tooltip-badge tooltip-badge-model">
            &#x2605; {t('tooltip.topModel')}
          </div>
        ))}

      <div className="tooltip-title">{model.heroDisplayName}</div>
      <div className="tooltip-stat">
        {t('tooltip.winrate', { value: formatWinrate(model.winrate) })}
      </div>
      <div className="tooltip-stat">
        {t('tooltip.pickRate', { value: formatPickRate(model.pickRate) })}
      </div>
      <PersonalStatLine
        games={model.personalGames}
        winrate={model.personalWinrate}
        scoreDelta={model.personalScoreDelta}
        t={t}
      />
      <RoleStatLine
        scoreDelta={model.roleScoreDelta}
        position={model.roleBestPosition}
        t={t}
      />
      <PairingStatLine scoreDelta={model.pairingScoreDelta} t={t} />
      {model.roleAvoided && (
        <div className="tooltip-stat tooltip-inert">{t('tooltip.roleAvoided')}</div>
      )}

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
