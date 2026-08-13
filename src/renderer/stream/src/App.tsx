import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { apiBase, isDemoMode, useStreamState } from './hooks/use-stream-state'
import { TopBar } from './components/TopBar'
import { PoolBoard } from './components/PoolBoard'
import { PlayerColumn } from './components/PlayerRows'
import { StatPanels } from './components/StatPanels'
import { PickTicker } from './components/PickTicker'
import i18n from './i18n'

// @DEV-GUIDE: Root of the stream SPA (OBS browser source) — a tournament-style
// caster view that mirrors the in-game AD draft screen: team columns flanking the
// central pool pedestal, stat strip along the bottom. Pure consumer of the SSE
// state; no electron API, no zubridge, no local business logic.
// Query params:
//   ?bg=transparent | chroma (#00ff00) | dark (solid broadcast look). Default:
//      transparent inside OBS browser sources (detected via window.obsstudio),
//      dark in a normal browser — otherwise the page sits on white
//   ?title=My%20Tournament   custom heading in the top bar
//   ?demo=1                  fake full draft for OBS scene setup; outlines the
//                            reserved zones productions can cover with their own
//                            sources (sponsors, caster cam)
//   ?api=<origin>            dev-mode only: origin of the stream server
// Language follows StreamBoardState.meta.language (the app's language setting).

type BgMode = 'transparent' | 'chroma' | 'dark'

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

function bgMode(): BgMode {
  const bg = param('bg')
  if (bg === 'transparent' || bg === 'chroma' || bg === 'dark') return bg
  // No explicit choice: OBS browser sources (they inject window.obsstudio) get
  // the transparent overlay look; a normal browser tab gets the dark broadcast
  // backdrop instead of the board floating on a white page.
  return 'obsstudio' in window ? 'transparent' : 'dark'
}

/**
 * Optional bundled broadcast art (resources/data/stream/<name>.png|jpg) served at
 * /art/<name>. Rendered behind the UI in dark mode only; missing art degrades to
 * the CSS gradient silently.
 */
function ArtLayer({ name }: { name: string }) {
  const [failed, setFailed] = useState(false)
  if (bgMode() !== 'dark' || failed) return null
  return (
    <img
      className="board-art"
      src={`${apiBase()}/art/${name}`}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  )
}

function App(): React.ReactElement {
  const { t } = useTranslation()
  const { board, connection } = useStreamState()
  const demo = isDemoMode()

  const language = board?.meta.language
  useEffect(() => {
    if (language && i18n.language !== language) {
      void i18n.changeLanguage(language)
    }
  }, [language])

  if (!board || board.phase === 'waiting') {
    return (
      <div className={`board bg-${bgMode()}`}>
        <ArtLayer name="board-bg" />
        <div
          className={`connection connection-${connection}`}
          title={t(`connection.${connection}`)}
        />
        <div className="waiting">
          <span className="waiting-wordmark">{t('wordmark')}</span>
          <span className="waiting-text">{t('waiting')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`board bg-${bgMode()}`}>
      <ArtLayer name="board-bg" />
      <TopBar
        title={param('title')}
        gsi={board.gsi}
        connection={connection}
        demo={demo}
      />

      <main className="board-main">
        <PlayerColumn
          team="radiant"
          players={board.players.filter((p) => p.team === 'radiant')}
        />
        <PoolBoard heroes={board.heroes} />
        <PlayerColumn
          team="dire"
          players={board.players.filter((p) => p.team === 'dire')}
        />
      </main>

      <PickTicker board={board} />

      <footer className="board-footer">
        <StatPanels panels={board.panels} />
        <div className={`reserved-zone reserved-bottom${demo ? ' reserved-visible' : ''}`}>
          {demo && <span>{t('reservedZone')}</span>}
        </div>
      </footer>
    </div>
  )
}

export default App
