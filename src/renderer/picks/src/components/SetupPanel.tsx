import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StreamTeam } from '@shared/types/stream'
import { buildDemoPicksState } from '../demo'
import { apiBase, usePicksState } from '../hooks/use-picks-state'
import i18n from '../i18n'
import {
  buildStripUrl,
  SPACING_DEFAULTS,
  SPACING_LIMITS,
  type PicksBg,
  type StripAlign,
  type StripOptions,
} from '../params'
import { TeamStrip } from './TeamStrip'

// @DEV-GUIDE: The /picks setup page — streamers tune both strips against a demo
// draft BEFORE the game, then copy the generated per-team URLs into OBS. Settings
// persist in this browser's localStorage purely as a convenience for reopening the
// page; the URLs are the actual transport (OBS's CEF has its own storage and never
// sees this page's). Spacing keys mirror StripOptions; alignment is per team.

interface SetupState {
  bg: PicksBg | null
  names: boolean
  alignRadiant: StripAlign
  alignDire: StripAlign
  rowGap: number
  slotGap: number
  heroGap: number
  ultGap: number
}

const SETUP_DEFAULTS: SetupState = {
  bg: null,
  names: true,
  alignRadiant: 'left',
  alignDire: 'right',
  ...SPACING_DEFAULTS,
}

const STORAGE_KEY = 'adplus-picks-setup-v1'

function loadStoredSetup(): SetupState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return SETUP_DEFAULTS
    return { ...SETUP_DEFAULTS, ...(JSON.parse(raw) as Partial<SetupState>) }
  } catch {
    return SETUP_DEFAULTS
  }
}

function stripOptions(setup: SetupState, team: StreamTeam): StripOptions {
  return {
    bg: setup.bg,
    names: setup.names,
    align: team === 'radiant' ? setup.alignRadiant : setup.alignDire,
    rowGap: setup.rowGap,
    slotGap: setup.slotGap,
    heroGap: setup.heroGap,
    ultGap: setup.ultGap,
  }
}

function Seg<T extends string | boolean>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="seg" role="group">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={option.value === value ? 'active' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function CopyUrl({ team, url }: { team: StreamTeam; url: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        /* clipboard unavailable — the code block stays selectable */
      })
  }

  return (
    <div className="url-row">
      <span className={`url-team ${team}`}>{t(`team.${team}`)}</span>
      <code>{url}</code>
      <button type="button" onClick={copy}>
        {copied ? t('setup.copied') : t('setup.copy')}
      </button>
    </div>
  )
}

const SPACING_KEYS = ['rowGap', 'slotGap', 'heroGap', 'ultGap'] as const

export function SetupPanel() {
  const { t } = useTranslation()
  const [setup, setSetup] = useState<SetupState>(loadStoredSetup)
  const [demo] = useState(buildDemoPicksState)
  // Strips always render the demo draft here; the live feed only drives language.
  const { picks } = usePicksState()

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setup))
  }, [setup])

  const language = picks?.meta.language
  useEffect(() => {
    if (language && i18n.language !== language) {
      void i18n.changeLanguage(language)
    }
  }, [language])

  // Production: same origin as the stream server. Dev: the page lives on the
  // vite dev server, so the URLs must point at the server's ?api= origin.
  const origin = apiBase() || window.location.origin
  const previewBg = setup.bg ?? 'transparent'

  return (
    <div className="setup-page">
      <div className="setup">
        <h1>{t('setup.title')}</h1>
        <p className="setup-intro">{t('setup.intro')}</p>

        <div className={`setup-preview bg-${previewBg}`}>
          <span className="setup-preview-label">{t('setup.preview')}</span>
          {(['radiant', 'dire'] as const).map((team) => (
            <div
              key={team}
              className={`setup-preview-half align-${stripOptions(setup, team).align}`}
            >
              <TeamStrip
                team={team}
                players={demo.players.filter((p) => p.team === team)}
                options={stripOptions(setup, team)}
              />
            </div>
          ))}
        </div>

        <div className="setup-controls">
          <div className="setup-card">
            <h2>{t('setup.background')}</h2>
            <div className="control-row">
              <Seg<PicksBg | 'auto'>
                value={setup.bg ?? 'auto'}
                options={[
                  { value: 'auto', label: t('setup.bg.transparent') },
                  { value: 'chroma', label: t('setup.bg.chroma') },
                  { value: 'dark', label: t('setup.bg.dark') },
                ]}
                onChange={(bg) =>
                  setSetup((s) => ({ ...s, bg: bg === 'auto' ? null : bg }))
                }
              />
            </div>
            <div className="control-row">
              <span>{t('setup.names')}</span>
              <Seg<boolean>
                value={setup.names}
                options={[
                  { value: true, label: t('setup.on') },
                  { value: false, label: t('setup.off') },
                ]}
                onChange={(names) => setSetup((s) => ({ ...s, names }))}
              />
            </div>
            <div className="control-row">
              <span>{t('setup.alignRadiant')}</span>
              <Seg<StripAlign>
                value={setup.alignRadiant}
                options={[
                  { value: 'left', label: t('setup.align.left') },
                  { value: 'right', label: t('setup.align.right') },
                ]}
                onChange={(alignRadiant) => setSetup((s) => ({ ...s, alignRadiant }))}
              />
            </div>
            <div className="control-row">
              <span>{t('setup.alignDire')}</span>
              <Seg<StripAlign>
                value={setup.alignDire}
                options={[
                  { value: 'left', label: t('setup.align.left') },
                  { value: 'right', label: t('setup.align.right') },
                ]}
                onChange={(alignDire) => setSetup((s) => ({ ...s, alignDire }))}
              />
            </div>
          </div>

          <div className="setup-card">
            <h2>{t('setup.spacing')}</h2>
            {SPACING_KEYS.map((key) => (
              <div key={key} className="slider-row">
                <label htmlFor={`spacing-${key}`}>{t(`setup.${key}`)}</label>
                <input
                  id={`spacing-${key}`}
                  type="range"
                  min={SPACING_LIMITS[key].min}
                  max={SPACING_LIMITS[key].max}
                  value={setup[key]}
                  onChange={(e) =>
                    setSetup((s) => ({ ...s, [key]: parseInt(e.target.value, 10) }))
                  }
                />
                <span className="slider-value">{setup[key]}</span>
              </div>
            ))}
            <button
              type="button"
              className="setup-reset"
              onClick={() => setSetup(SETUP_DEFAULTS)}
            >
              {t('setup.reset')}
            </button>
          </div>
        </div>

        <div className="setup-card">
          <h2>{t('setup.urls')}</h2>
          {(['radiant', 'dire'] as const).map((team) => (
            <CopyUrl
              key={team}
              team={team}
              url={buildStripUrl(origin, team, stripOptions(setup, team))}
            />
          ))}
          <p className="url-hint">{t('setup.urlHint')}</p>
        </div>
      </div>
    </div>
  )
}
