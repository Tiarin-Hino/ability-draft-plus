import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StreamAbilitySlot } from '@shared/types/stream'
import { apiBase } from '../hooks/use-stream-state'

// Icon files are served by the stream server (/icons/* route lands in phase 3).
// Until then — and for any CDN miss — the onError fallback shows an initial-letter
// block, so the board is fully usable without a single icon on disk.

interface AbilityTileProps {
  slot: StreamAbilitySlot
  size?: 'normal' | 'small' | 'large'
}

export function AbilityTile({ slot, size = 'normal' }: AbilityTileProps) {
  const { t } = useTranslation()
  const [iconFailed, setIconFailed] = useState(false)

  const displayName = slot.isUnknown ? t('unknownAbility') : slot.displayName
  const showIcon = slot.iconPath !== null && !iconFailed

  const classes = [
    'tile',
    size === 'small' ? 'tile-small' : '',
    size === 'large' ? 'tile-large' : '',
    slot.isPicked ? 'tile-picked' : '',
    slot.isTopTier ? 'tile-top-tier' : '',
    slot.isUnknown ? 'tile-unknown' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} title={displayName}>
      {showIcon ? (
        <img
          className="tile-icon"
          src={`${apiBase()}${slot.iconPath}`}
          alt={displayName}
          onError={() => setIconFailed(true)}
        />
      ) : (
        <div className="tile-fallback" aria-label={displayName}>
          {displayName.charAt(0).toUpperCase()}
        </div>
      )}
      {slot.winrate !== null && (
        <span className="tile-winrate">{(slot.winrate * 100).toFixed(1)}%</span>
      )}
    </div>
  )
}
