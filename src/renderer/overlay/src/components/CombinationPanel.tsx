import { useTranslation } from 'react-i18next'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { SynergyPairDisplay, HeroSynergyDisplay } from '@shared/types'

interface CombinationPanelProps {
  variant: 'op' | 'trap'
  abilityCombinations: SynergyPairDisplay[]
  heroSynergies: HeroSynergyDisplay[]
  visible: boolean
  onToggle: () => void
}

function formatWr(wr: number): string {
  return `${(wr * 100).toFixed(1)}%`
}

export function CombinationPanel({
  variant,
  abilityCombinations,
  heroSynergies,
  visible,
  onToggle,
}: CombinationPanelProps): React.ReactElement | null {
  const { t } = useTranslation()
  const { onMouseEnter, onMouseLeave } = useMousePassthrough()

  const hasContent = abilityCombinations.length > 0 || heroSynergies.length > 0
  if (!hasContent) return null

  const titleKey = variant === 'op' ? 'opCombinations.title' : 'trapCombinations.title'
  const showKey = variant === 'op' ? 'opCombinations.show' : 'trapCombinations.show'
  const hideKey = variant === 'op' ? 'opCombinations.hide' : 'trapCombinations.hide'

  if (!visible) {
    return (
      <button
        className={`overlay-btn overlay-interactive ${variant === 'op' ? 'overlay-btn-purple' : 'overlay-btn-red'}`}
        onClick={onToggle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {t(showKey)}
      </button>
    )
  }

  const ariaLabel = variant === 'op' ? 'OP Combinations' : 'Trap Combinations'
  const itemPrefix = variant === 'op' ? '\u2191 ' : '\u2193 '

  return (
    <div
      className={`combination-panel overlay-interactive combination-panel-${variant}`}
      role="region"
      aria-label={ariaLabel}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="combination-panel-header">
        <span className="combination-panel-title">{t(titleKey)}</span>
        <button
          className={`overlay-btn ${variant === 'op' ? 'overlay-btn-purple' : 'overlay-btn-red'}`}
          onClick={onToggle}
          style={{ minHeight: 28, padding: '4px 10px', fontSize: 12 }}
        >
          {t(hideKey)}
        </button>
      </div>

      {abilityCombinations.map((combo, i) => (
        <div key={`a-${i}`} className="combination-panel-item">
          {itemPrefix}
          <span className={combo.inflatedSynergy ? 'combination-panel-inflated' : ''}>
            {combo.inflatedSynergy ? '~' : ''}{combo.ability1DisplayName}
          </span>{' '}
          + <span>{combo.ability2DisplayName}</span>{' '}
          ({formatWr(combo.synergyWinrate)})
          {combo.suggestedThird && (
            <span
              className="combination-panel-third"
              title={t('opCombinations.tripletTooltip', {
                winrate: formatWr(combo.suggestedThird.tripletWinrate),
              })}
            >
              +{combo.suggestedThird.displayName}
            </span>
          )}
        </div>
      ))}

      {abilityCombinations.length > 0 && heroSynergies.length > 0 && (
        <hr className="combination-panel-separator" />
      )}

      {heroSynergies.map((syn, i) => (
        <div key={`h-${i}`} className="combination-panel-item combination-panel-hero-synergy">
          {itemPrefix}
          <span>{syn.heroDisplayName}</span> + <span>{syn.abilityDisplayName}</span>{' '}
          ({formatWr(syn.synergyWinrate)})
        </div>
      ))}
    </div>
  )
}
