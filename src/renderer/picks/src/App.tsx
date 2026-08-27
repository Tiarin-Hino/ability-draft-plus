import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { StreamTeam } from '@shared/types/stream'
import { usePicksState } from './hooks/use-picks-state'
import { parseStripOptions, type PicksBg } from './params'
import { TeamStrip } from './components/TeamStrip'
import { SetupPanel } from './components/SetupPanel'
import i18n from './i18n'

// @DEV-GUIDE: Root of the Picks View SPA (Streamer View № 2). Two page modes on one
// entry, split by the ?team= query param:
// - /picks?team=radiant|dire — one team's drafted-picks strip (the OBS browser
//   source). Pure consumer of /picks/events; renders NOTHING while no draft has been
//   recorded (an invisible transparent source), and keeps the last recorded draft on
//   screen through the whole game (the server's snapshot survives overlay resets).
// - /picks — the setup page: demo strips + controls that bake every display option
//   into the two per-team URLs (see params.ts for the full list).
// Query params (strip pages): team, bg, names, align, rowgap, slotgap, herogap,
// ultgap, demo, api (dev only). Language follows PicksViewState.meta.language.

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

function resolveBg(explicit: PicksBg | null): PicksBg {
  if (explicit) return explicit
  // OBS browser sources inject window.obsstudio and composite transparency; a
  // normal browser tab gets the dark backdrop instead of strips on white.
  return 'obsstudio' in window ? 'transparent' : 'dark'
}

function StripPage({ team }: { team: StreamTeam }) {
  const { t } = useTranslation()
  const { picks } = usePicksState()
  const options = parseStripOptions(
    new URLSearchParams(window.location.search),
    team,
  )
  const bg = resolveBg(options.bg)

  const language = picks?.meta.language
  useEffect(() => {
    if (language && i18n.language !== language) {
      void i18n.changeLanguage(language)
    }
  }, [language])

  if (!picks) {
    // No draft recorded yet: stay invisible in OBS; hint only on a dark page,
    // where a human is looking at a browser tab.
    return (
      <div className={`strip-page bg-${bg}`}>
        {bg === 'dark' && <div className="waiting">{t('waiting')}</div>}
      </div>
    )
  }

  return (
    <div className={`strip-page bg-${bg}`}>
      <TeamStrip
        team={team}
        players={picks.players.filter((p) => p.team === team)}
        options={options}
      />
    </div>
  )
}

function App(): React.ReactElement {
  const team = param('team')
  if (team === 'radiant' || team === 'dire') {
    return <StripPage team={team} />
  }
  return <SetupPanel />
}

export default App
