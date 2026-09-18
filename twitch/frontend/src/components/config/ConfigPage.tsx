import { useCallback, useEffect, useMemo, useState } from 'react'
import { createEbsClient, type ChannelStatus } from '../../net/ebs-client'
import { readParams, resolveEbsUrl } from '../../app/bootstrap'
import {
  CONFIG_VERSION,
  DEFAULT_CONFIG,
  parseBroadcasterConfig,
  serializeBroadcasterConfig,
  type BroadcasterConfig,
  type LauncherCorner,
} from '../../twitch/config-service'
import { getTwitch, type TwitchAuth } from '../../twitch/ext'
import { FALLBACK_1080P } from '../../geometry/fallback-1080p'
import { TOPBAR_1080P } from '../../geometry/topbar-1080p'
import { gameRect, projectRects, projectTopBar } from '../../geometry/project'

// Broadcaster configuration page: pairing code for the desktop app, game-rect and
// top-bar calibration (saved to the broadcaster configuration segment), status.

const PREVIEW_W = 640
const PREVIEW_H = 360

export function ConfigPage() {
  const twitch = useMemo(() => getTwitch(), [])
  const ebs = useMemo(() => createEbsClient(resolveEbsUrl(readParams())), [])
  const [auth, setAuth] = useState<TwitchAuth | null>(null)
  const [config, setConfig] = useState<BroadcasterConfig>(DEFAULT_CONFIG)
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    twitch.onAuthorized(setAuth)
    const applyConfig = () => setConfig(parseBroadcasterConfig(twitch.configuration.broadcaster?.content))
    applyConfig()
    twitch.configuration.onChanged(applyConfig)
  }, [twitch])

  const update = (patch: Partial<BroadcasterConfig>) => {
    setConfig((c) => ({ ...c, ...patch }))
    setSaved(false)
  }

  const save = () => {
    twitch.configuration.set('broadcaster', CONFIG_VERSION, serializeBroadcasterConfig(config))
    setSaved(true)
  }

  return (
    <main className="config">
      <h1>Ability Draft Plus</h1>
      <PairingCard auth={auth} ebs={ebs} />
      <CalibrationCard config={config} onChange={update} onSave={save} saved={saved} />
      <StatusCard ebsUrl={ebs.baseUrl} />
    </main>
  )
}

function PairingCard({ auth, ebs }: { auth: TwitchAuth | null; ebs: ReturnType<typeof createEbsClient> }) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<ChannelStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshStatus = useCallback(() => {
    if (!auth) return
    ebs.getStatus(auth.channelId).then(setStatus).catch(() => undefined)
  }, [auth, ebs])

  useEffect(() => {
    refreshStatus()
    const timer = window.setInterval(refreshStatus, 5_000)
    return () => window.clearInterval(timer)
  }, [refreshStatus])

  const requestCode = async () => {
    if (!auth) return
    setBusy(true)
    setError(null)
    try {
      setCode(await ebs.pairStart(auth.token))
    } catch (e) {
      setError(`Could not get a pairing code (${e instanceof Error ? e.message : String(e)}).`)
    } finally {
      setBusy(false)
    }
  }

  const formatted = code ? `${code.code.slice(0, 4)}-${code.code.slice(4)}` : null

  return (
    <section className="card">
      <h2>1. Pair with the desktop app</h2>
      {status?.paired ? (
        <p className="ok">
          Paired{status.appVersion ? ` with Ability Draft Plus ${status.appVersion}` : ''}
          {status.lastPublishAt ? ` · last update ${new Date(status.lastPublishAt).toLocaleTimeString()}` : ' · no update received yet'}
          {status.phase ? ` · ${status.phase}` : ''}
        </p>
      ) : (
        <p className="muted">Not paired yet.</p>
      )}
      <ol>
        <li>Press the button to get a pairing code (valid 10 minutes, single use).</li>
        <li>In Ability Draft Plus open Streaming → Twitch extension and paste the code.</li>
        <li>Turn on “Broadcast the draft to Twitch” in the app.</li>
      </ol>
      <div className="row">
        <button type="button" onClick={requestCode} disabled={!auth || busy}>
          {status?.paired ? 'Generate a new pairing code' : 'Get pairing code'}
        </button>
        {formatted && <code className="pair-code">{formatted}</code>}
      </div>
      {error && <p className="error">{error}</p>}
      {!auth && (
        <p className="muted">
          Waiting for Twitch… pairing only works when this page is opened from Twitch (Creator
          Dashboard → Extensions → My Extensions → the extension's Configure button), where Twitch
          signs the request for your channel.
        </p>
      )}
    </section>
  )
}

function CalibrationCard({
  config,
  onChange,
  onSave,
  saved,
}: {
  config: BroadcasterConfig
  onChange: (patch: Partial<BroadcasterConfig>) => void
  onSave: () => void
  saved: boolean
}) {
  const video = { x: 0, y: 0, w: PREVIEW_W, h: PREVIEW_H }
  const game = gameRect(video, config.gameRect)
  const pool = projectRects(FALLBACK_1080P.pool, game)
  const models = projectRects(FALLBACK_1080P.models, game)
  const portraits = projectTopBar(TOPBAR_1080P, game, config.ingame)

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    apply: (v: number) => void,
  ) => (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => apply(Number(e.target.value))} />
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => apply(Number(e.target.value))} />
    </label>
  )

  return (
    <section className="card">
      <h2>2. Align the overlay with your scene</h2>
      <p className="muted">
        Leave everything at the defaults if your game fills the whole stream. If the game is a smaller
        source inside your scene, describe where it sits (fractions of the stream canvas).
      </p>
      <div className="calib">
        <div className="calib-controls">
          <h3>Game area in the stream</h3>
          {slider('Left', config.gameRect.x, 0, 0.9, 0.001, (x) => onChange({ gameRect: { ...config.gameRect, x } }))}
          {slider('Top', config.gameRect.y, 0, 0.9, 0.001, (y) => onChange({ gameRect: { ...config.gameRect, y } }))}
          {slider('Width', config.gameRect.w, 0.1, 1, 0.001, (w) => onChange({ gameRect: { ...config.gameRect, w } }))}
          {slider('Height', config.gameRect.h, 0.1, 1, 0.001, (h) => onChange({ gameRect: { ...config.gameRect, h } }))}
          <h3>In-game top bar fine-tune</h3>
          {slider('Shift X', config.ingame.dx, -0.2, 0.2, 0.001, (dx) => onChange({ ingame: { ...config.ingame, dx } }))}
          {slider('Shift Y', config.ingame.dy, -0.2, 0.2, 0.001, (dy) => onChange({ ingame: { ...config.ingame, dy } }))}
          {slider('Scale', config.ingame.scale, 0.5, 1.5, 0.01, (scale) => onChange({ ingame: { ...config.ingame, scale } }))}
          <h3>Launcher corner</h3>
          <div className="row">
            {(['tl', 'tr', 'bl', 'br'] as LauncherCorner[]).map((corner) => (
              <label key={corner} className="radio">
                <input
                  type="radio"
                  name="corner"
                  checked={config.launcherCorner === corner}
                  onChange={() => onChange({ launcherCorner: corner })}
                />
                {{ tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' }[corner]}
              </label>
            ))}
          </div>
          <div className="row">
            <button type="button" onClick={() => onChange({ gameRect: DEFAULT_CONFIG.gameRect, ingame: DEFAULT_CONFIG.ingame })}>
              Reset to full frame
            </button>
            <button type="button" className="primary" onClick={onSave} disabled={saved}>
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
        <div className="calib-preview" style={{ width: PREVIEW_W, height: PREVIEW_H }}>
          <div className="preview-game" style={{ left: game.x, top: game.y, width: game.w, height: game.h }} />
          {pool.map((r, i) => r && <div key={i} className="preview-slot" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />)}
          {models.map((r, i) => r && <div key={`m${i}`} className="preview-model" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />)}
          {portraits.map((r, i) => (
            <div key={`p${i}`} className={`preview-portrait ${i < 5 ? 'radiant' : 'dire'}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
          ))}
        </div>
      </div>
    </section>
  )
}

function StatusCard({ ebsUrl }: { ebsUrl: string }) {
  return (
    <section className="card">
      <h2>Status</h2>
      <dl className="kv">
        <dt>Extension version</dt>
        <dd>{__EXT_VERSION__}</dd>
        <dt>Backend</dt>
        <dd>
          <code>{ebsUrl}</code>
        </dd>
      </dl>
    </section>
  )
}
