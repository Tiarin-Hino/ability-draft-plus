import { useEffect } from 'react'
import type { TwitchCompactState, TwitchRichState } from '@shared/types/twitch'
import { useOverlayStore } from '../../app/store'
import { FALLBACK_1080P } from '../../geometry/fallback-1080p'
import type { PxRect } from '../../geometry/types'
import { AbilityDetailsPanel } from './AbilityDetailsPanel'
import { HeroDetailsPanel } from './HeroDetailsPanel'

// Hosts the details panel for the current selection, docked on the side of the frame
// opposite the selected slot so it never covers what the viewer just clicked.

export function DetailsDock({
  compact,
  rich,
  viewport,
}: {
  compact: TwitchCompactState
  rich: TwitchRichState | null
  viewport: { iframe: { w: number; h: number }; game: PxRect }
}) {
  const selection = useOverlayStore((s) => s.ui.selection)
  const select = useOverlayStore((s) => s.select)

  useEffect(() => {
    if (!selection || selection.kind === 'player') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, select])

  if (!selection || selection.kind === 'player') return null

  const geometry = rich?.geometry ?? FALLBACK_1080P
  const anchor =
    selection.kind === 'ability' ? geometry.pool[selection.i] : geometry.models[selection.heroOrder]
  const anchorX = anchor ? viewport.game.x + (anchor[0] + anchor[2] / 2) * viewport.game.w : viewport.iframe.w / 2
  const side = anchorX < viewport.iframe.w / 2 ? 'right' : 'left'

  return (
    <div className={`details-dock dock-${side}`} role="dialog" aria-label="Details">
      <button type="button" className="details-close" onClick={() => select(null)} aria-label="Close">
        ×
      </button>
      {selection.kind === 'ability' ? (
        <AbilityDetailsPanel compact={compact} rich={rich} index={selection.i} />
      ) : (
        <HeroDetailsPanel compact={compact} rich={rich} heroOrder={selection.heroOrder} />
      )}
    </div>
  )
}
