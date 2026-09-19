import type { TwitchPhase } from '@shared/types/twitch'
import { useOverlayStore } from '../../app/store'

const PHASE_LABEL: Record<TwitchPhase, string> = {
  waiting: 'Waiting for draft',
  drafting: 'Drafting',
  ingame: 'In game',
  ended: 'Draft finished',
}

export function Launcher({ phase, hasBoard }: { phase: TwitchPhase; hasBoard: boolean }) {
  const minimized = useOverlayStore((s) => s.ui.minimized)
  const connection = useOverlayStore((s) => s.connection)
  const expandAll = useOverlayStore((s) => s.ui.expandAll)
  const overview = useOverlayStore((s) => s.ui.overview)
  const corner = useOverlayStore((s) => s.config.launcherCorner)
  const caster = useOverlayStore((s) => s.ui.caster)
  const hasLive = useOverlayStore((s) => s.live !== null)
  const toggleMinimized = useOverlayStore((s) => s.toggleMinimized)
  const setExpandAll = useOverlayStore((s) => s.setExpandAll)
  const setOverview = useOverlayStore((s) => s.setOverview)
  const setCaster = useOverlayStore((s) => s.setCaster)

  const status = connection === 'stale' ? 'signal lost' : connection === 'offline' ? 'app offline' : null

  return (
    <div className={`launcher launcher-${corner}`}>
      <button
        type="button"
        className="launcher-pill"
        onClick={toggleMinimized}
        title={minimized ? 'Show Ability Draft Plus' : 'Hide Ability Draft Plus'}
      >
        <span className="launcher-mark">AD+</span>
        <span className={`launcher-phase phase-${phase}${status ? ' launcher-warn' : ''}`}>
          {status ?? PHASE_LABEL[phase]}
        </span>
      </button>
      {!minimized && hasBoard && (
        <div className="launcher-actions">
          <button
            type="button"
            className={`launcher-btn${overview ? ' is-active' : ''}`}
            onClick={() => setOverview(!overview)}
          >
            Draft overview
          </button>
          {(phase === 'ingame' || phase === 'ended') && (
            <button
              type="button"
              className={`launcher-btn${expandAll ? ' is-active' : ''}`}
              onClick={() => setExpandAll(!expandAll)}
            >
              {expandAll ? 'Collapse' : 'Show all picks'}
            </button>
          )}
          {/* Only offered when telemetry is actually flowing — a caster is
              spectating. A playing streamer never has it, so the button never
              appears rather than opening an empty panel. */}
          {hasLive && (
            <button
              type="button"
              className={`launcher-btn${caster ? ' is-active' : ''}`}
              onClick={() => setCaster(!caster)}
            >
              {caster ? 'Hide stats' : 'Scoreboard'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
