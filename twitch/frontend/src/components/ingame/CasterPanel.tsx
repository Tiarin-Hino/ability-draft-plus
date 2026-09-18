import type { TwitchCompactState, TwitchLivePlayer, TwitchLiveState } from '@shared/types/twitch'
import {
  TWITCH_LIVE_ALIVE,
  TWITCH_LIVE_BUYBACK_READY,
  TWITCH_LIVE_SCEPTER,
  TWITCH_LIVE_SHARD,
} from '@shared/types/twitch'
import { useOverlayStore } from '../../app/store'
import { heroDisplayName, playerModel, playerName, rowForSeat, teamOf } from '../../data/selectors'
import { HeroPortrait, ItemIcon } from '../common/Art'

// Caster edition: the observer panel viewers open in game. Fed by the telemetry
// message (spectator-only), which is delay-buffered like the board so it matches
// the video the viewer is actually watching.
//
// Rows are seats — the in-game top-bar order — so the panel reads like the
// scoreboard above it, but every lookup resolves through rowForSeat() because
// the payload is keyed by draft row and the orders differ.

const SEATS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

/** 12345 -> "12.3k"; small numbers stay exact. */
function short(value: number): string {
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

/** 200 -> "3:20" */
function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Buyback shown for EVERY player, not just the dead ones: whether someone is
 * holding buyback going into a fight is the question a caster asks, and by the
 * time they are dead the answer is already decided. Three states, because
 * "cannot afford" and "used it recently" are different situations that both
 * otherwise read as a blank.
 */
function BuybackPip({ flags, cost, cooldown }: { flags: number; cost: number; cooldown: number }) {
  const ready = (flags & TWITCH_LIVE_BUYBACK_READY) !== 0
  if (ready) {
    return (
      <span className="pip pip-buyback" title={`Buyback available — ${cost} gold`}>
        BB
      </span>
    )
  }
  if (cooldown > 0) {
    return (
      <span className="pip pip-bb-cooldown" title={`Buyback on cooldown — ${mmss(cooldown)} left`}>
        BB {mmss(cooldown)}
      </span>
    )
  }
  return (
    <span className="pip pip-bb-none" title={`Cannot afford buyback — needs ${cost} gold`}>
      BB
    </span>
  )
}

function TeamTotals({ label, rows, team }: { label: string; rows: (TwitchLivePlayer | null)[]; team: 'radiant' | 'dire' }) {
  const total = rows.reduce((sum, p) => sum + (p?.[0] ?? 0), 0)
  return (
    <div className={`caster-total team-${team}`}>
      <span className="caster-total-label">{label}</span>
      <span className="caster-total-value">{short(total)}</span>
    </div>
  )
}

function PlayerRow({
  compact,
  live,
  seat,
}: {
  compact: TwitchCompactState
  live: TwitchLiveState
  seat: number
}) {
  const rich = useOverlayStore((s) => s.rich[compact.d] ?? null)
  const catalog = useOverlayStore((s) => s.catalog)
  const row = rowForSeat(compact, seat)
  const stats = row === null ? null : live.players[row]
  if (row === null || !stats) return null

  const model = playerModel(compact, row)
  const hero = heroDisplayName(rich, catalog, model.cdn, model.heroOrder ?? undefined)
  const name = playerName(compact, rich, row) ?? `Player ${row + 1}`
  const flags = stats[13]
  const dead = (flags & TWITCH_LIVE_ALIVE) === 0
  const items = stats[17]

  return (
    <div className={`caster-row team-${teamOf(seat)}${dead ? ' is-dead' : ''}`}>
      <HeroPortrait cdn={model.cdn} label={hero} width={44} height={25} />
      <div className="caster-identity">
        <span className="caster-name" title={name}>
          {name}
        </span>
        <span className="caster-sub">
          <span className="caster-level">{stats[3]}</span>
          {(flags & TWITCH_LIVE_SCEPTER) !== 0 && <span className="pip pip-scepter" title="Aghanim's Scepter">S</span>}
          {(flags & TWITCH_LIVE_SHARD) !== 0 && <span className="pip pip-shard" title="Aghanim's Shard">◆</span>}
          {dead && (
            <span className="pip pip-dead" title="Respawning">
              {stats[14]}s
            </span>
          )}
          <BuybackPip flags={flags} cost={stats[15]} cooldown={stats[16]} />
        </span>
      </div>
      <div className="caster-kda" title="Kills / deaths / assists">
        {stats[4]}/{stats[5]}/{stats[6]}
      </div>
      <div className="caster-net" title="Net worth">
        {short(stats[0])}
      </div>
      <div className="caster-gpm" title="Gold and XP per minute">
        {stats[1]}
        <span className="caster-xpm">{stats[2]}</span>
      </div>
      <div className="caster-dmg" title="Hero damage dealt / taken">
        {short(stats[9])}
        <span className="caster-taken">{short(stats[12])}</span>
      </div>
      <div className="caster-items">
        {items.slice(0, 6).map((item, i) => (
          <ItemIcon key={i} name={item} size={22} />
        ))}
        {items[9] && <ItemIcon name={items[9]} size={22} />}
      </div>
    </div>
  )
}

export function CasterPanel({ compact }: { compact: TwitchCompactState }) {
  const live = useOverlayStore((s) => s.live)
  const setCaster = useOverlayStore((s) => s.setCaster)
  if (!live) return null

  const rows = live.players
  return (
    <div className="caster-panel" onClick={(e) => e.stopPropagation()}>
      <header className="caster-head">
        <h2>Scoreboard</h2>
        <div className="caster-totals">
          <TeamTotals label="Radiant" team="radiant" rows={rows.slice(0, 5)} />
          <TeamTotals label="Dire" team="dire" rows={rows.slice(5)} />
        </div>
        <button type="button" className="details-close" onClick={() => setCaster(false)} aria-label="Close">
          ×
        </button>
      </header>
      <div className="caster-legend">
        <span>Player</span>
        <span>K/D/A</span>
        <span>Net</span>
        <span>GPM / XPM</span>
        <span>Dmg / taken</span>
        <span>Items</span>
      </div>
      <div className="caster-rows">
        {SEATS.map((seat) => (
          <PlayerRow key={seat} compact={compact} live={live} seat={seat} />
        ))}
      </div>
    </div>
  )
}
