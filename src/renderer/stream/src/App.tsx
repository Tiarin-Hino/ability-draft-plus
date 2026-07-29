import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useStreamState } from './hooks/use-stream-state'
import { HeroPoolGrid } from './components/HeroPoolGrid'
import { PlayerRows } from './components/PlayerRows'
import { StatPanels } from './components/StatPanels'
import i18n from './i18n'

// @DEV-GUIDE: Root of the stream SPA (OBS browser source). Pure consumer of the SSE
// state — no electron API, no zubridge, no local business logic.
// Query params:
//   ?bg=transparent (default) | chroma (#00ff00 for chroma keying) | dark (solid)
//   ?api=<origin>  dev-mode only: origin of the stream server (page is on the vite server)
// Language follows StreamBoardState.meta.language (the app's language setting).

type BgMode = 'transparent' | 'chroma' | 'dark'

function bgMode(): BgMode {
  const bg = new URLSearchParams(window.location.search).get('bg')
  return bg === 'chroma' || bg === 'dark' ? bg : 'transparent'
}

function App(): React.ReactElement {
  const { t } = useTranslation()
  const { board, connection } = useStreamState()

  const language = board?.meta.language
  useEffect(() => {
    if (language && i18n.language !== language) {
      void i18n.changeLanguage(language)
    }
  }, [language])

  return (
    <div className={`board bg-${bgMode()}`}>
      <div
        className={`connection connection-${connection}`}
        title={t(`connection.${connection}`)}
        aria-label={t(`connection.${connection}`)}
      />
      {!board || board.phase === 'waiting' ? (
        <div className="waiting">{t('waiting')}</div>
      ) : (
        <>
          <main className="board-main">
            <HeroPoolGrid heroes={board.heroes} />
            <StatPanels panels={board.panels} />
          </main>
          <PlayerRows players={board.players} />
        </>
      )}
    </div>
  )
}

export default App
