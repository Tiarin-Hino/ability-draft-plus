import { useTranslation } from 'react-i18next'
import type { StreamComboDisplay, StreamPanels } from '@shared/types/stream'
import { AbilityTile } from './AbilityTile'
import { apiBase } from '../hooks/use-stream-state'

function ComboEntry({ combo }: { combo: StreamComboDisplay }) {
  return (
    <div className="combo-entry">
      <div className="combo-icons">
        {[combo.ability1, combo.ability2].map((ability, i) => (
          <span className="combo-ability" key={i} title={ability.displayName}>
            {i > 0 && <span className="combo-plus">+</span>}
            {ability.iconPath ? (
              <img
                src={`${apiBase()}${ability.iconPath}`}
                alt={ability.displayName}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : null}
            <span className="combo-name">{ability.displayName}</span>
          </span>
        ))}
      </div>
      <span className="combo-winrate">{(combo.synergyWinrate * 100).toFixed(1)}%</span>
    </div>
  )
}

export function StatPanels({ panels }: { panels: StreamPanels }) {
  const { t } = useTranslation()
  return (
    <aside className="panels" aria-label="Draft statistics">
      <div className="panel">
        <h2 className="panel-title">{t('panels.topWinrate')}</h2>
        <div className="panel-tiles">
          {panels.topWinrateInPool.map((slot, i) => (
            <div className="top-winrate-entry" key={i}>
              <AbilityTile slot={slot} size="small" />
              {slot.pickPosition !== null && (
                <span className="avg-pick" title={t('avgPick', { n: Math.round(slot.pickPosition) })}>
                  #{Math.round(slot.pickPosition)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {panels.opCombos.length > 0 && (
        <div className="panel panel-op">
          <h2 className="panel-title">{t('panels.opCombos')}</h2>
          {panels.opCombos.map((combo, i) => (
            <ComboEntry key={i} combo={combo} />
          ))}
        </div>
      )}

      {panels.trapCombos.length > 0 && (
        <div className="panel panel-trap">
          <h2 className="panel-title">{t('panels.trapCombos')}</h2>
          {panels.trapCombos.map((combo, i) => (
            <ComboEntry key={i} combo={combo} />
          ))}
        </div>
      )}
    </aside>
  )
}
