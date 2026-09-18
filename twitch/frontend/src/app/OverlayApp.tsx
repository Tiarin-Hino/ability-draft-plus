import { selectCurrentRich, useOverlayStore } from './store'
import { useViewport } from './useViewport'
import { Launcher } from '../components/launcher/Launcher'
import { DraftOverlay } from '../components/draft/DraftOverlay'
import { InGameOverlay } from '../components/ingame/InGameOverlay'
import { DetailsDock } from '../components/details/DetailsDock'
import { DraftOverviewModal } from '../components/overview/DraftOverviewModal'
import { CasterPanel } from '../components/ingame/CasterPanel'

export function OverlayApp() {
  const compact = useOverlayStore((s) => s.compact)
  const rich = useOverlayStore(selectCurrentRich)
  const minimized = useOverlayStore((s) => s.ui.minimized)
  const overview = useOverlayStore((s) => s.ui.overview)
  const caster = useOverlayStore((s) => s.ui.caster)
  const theme = useOverlayStore((s) => s.context.theme)
  const viewport = useViewport()

  const phase = compact?.p ?? 'waiting'
  const hasBoard = Boolean(compact?.pool)

  return (
    <div className={`overlay-root theme-${theme}`}>
      <Launcher phase={phase} hasBoard={hasBoard} />
      {!minimized && hasBoard && phase === 'drafting' && (
        <DraftOverlay compact={compact!} rich={rich} game={viewport.game} />
      )}
      {!minimized && hasBoard && (phase === 'ingame' || phase === 'ended') && (
        <InGameOverlay compact={compact!} rich={rich} game={viewport.game} />
      )}
      {!minimized && hasBoard && overview && (
        <DraftOverviewModal compact={compact!} rich={rich} />
      )}
      {!minimized && hasBoard && caster && <CasterPanel compact={compact!} />}
      {!minimized && hasBoard && (
        <DetailsDock compact={compact!} rich={rich} viewport={viewport} />
      )}
    </div>
  )
}
