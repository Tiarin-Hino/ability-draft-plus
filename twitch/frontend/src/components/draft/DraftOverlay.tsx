import { useMemo } from 'react'
import type { TwitchCompactState, TwitchRichState } from '@shared/types/twitch'
import { useOverlayStore } from '../../app/store'
import { abilityCdnUrl, heroCdnUrl } from '../../data/icons'
import { displayName, heroDisplayName, isModelPicked, partnersInPool, pickedBy, playerName, poolSlots } from '../../data/selectors'
import { FALLBACK_1080P } from '../../geometry/fallback-1080p'
import { projectRects } from '../../geometry/project'
import type { PxRect } from '../../geometry/types'

// Invisible-until-hovered hit regions aligned to the streamer's draft screen. The root is
// pointer-events:none; only regions/panels opt in, so the player's own controls keep working.

function style(rect: PxRect): React.CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.w, height: rect.h }
}

export function DraftOverlay({
  compact,
  rich,
  game,
}: {
  compact: TwitchCompactState
  rich: TwitchRichState | null
  game: PxRect
}) {
  const catalog = useOverlayStore((s) => s.catalog)
  const selection = useOverlayStore((s) => s.ui.selection)
  const select = useOverlayStore((s) => s.select)
  const demoBoard = useOverlayStore((s) => s.demoBoard)

  const geometry = rich?.geometry ?? FALLBACK_1080P
  const poolRects = useMemo(() => projectRects(geometry.pool, game), [geometry, game])
  const modelRects = useMemo(() => projectRects(geometry.models, game), [geometry, game])
  const slots = useMemo(() => poolSlots(compact), [compact])

  // Demo only: a surface under the generated tiles, so the pool reads as a board
  // rather than icons floating on black. Derived from the rects themselves, so it
  // follows the geometry instead of hard-coding a box.
  const demoBounds = useMemo(() => {
    const rects = [...poolRects, ...modelRects].filter((r): r is PxRect => r !== null)
    if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
    const pad = 24
    const x = Math.min(...rects.map((r) => r.x))
    const y = Math.min(...rects.map((r) => r.y))
    const right = Math.max(...rects.map((r) => r.x + r.w))
    const bottom = Math.max(...rects.map((r) => r.y + r.h))
    return { x: x - pad, y: y - pad, w: right - x + pad * 2, h: bottom - y + pad * 2 }
  }, [poolRects, modelRects])

  const selectedIndex = selection?.kind === 'ability' ? selection.i : null
  const partners = useMemo(() => {
    if (selectedIndex === null) return { strong: new Set<number>(), weak: new Set<number>() }
    const { strong, weak } = partnersInPool(rich, compact, selectedIndex)
    return { strong: new Set(strong.map((p) => p.i)), weak: new Set(weak.map((p) => p.i)) }
  }, [rich, compact, selectedIndex])

  return (
    <div className="hit-layer">
      {/*
       * Demo only. Opened standalone there is no stream behind the overlay, so
       * ?demo=1 rendered as a blank frame. Drawing a screenshot behind it was
       * worse: a photo of one draft under the data of another puts every icon,
       * name and picked-marker in the wrong place. This paints the pool the demo
       * actually describes, through the SAME rects as the hit regions, so the
       * board and the panels cannot disagree.
       */}
      {demoBoard && (
        <div className="demo-board" aria-hidden="true">
          <div className="demo-board-surface" style={style(demoBounds)} />
          {slots.map((slot) => {
            const rect = poolRects[slot.i]
            if (!rect || !slot.name) return null
            return (
              <img
                key={`demo-${slot.i}`}
                className={slot.picked ? 'demo-tile is-picked' : 'demo-tile'}
                style={style(rect)}
                src={abilityCdnUrl(slot.name)}
                alt=""
              />
            )
          })}
          {modelRects.map((rect, heroOrder) => {
            const cdn = compact.pool?.[heroOrder]?.[0] ?? null
            if (!rect || typeof cdn !== 'string') return null
            return (
              <img
                key={`demo-hero-${heroOrder}`}
                className={isModelPicked(compact, heroOrder) ? 'demo-tile is-picked' : 'demo-tile'}
                style={style(rect)}
                src={heroCdnUrl(cdn)}
                alt=""
              />
            )
          })}
        </div>
      )}
      {slots.map((slot) => {
        const rect = poolRects[slot.i]
        if (!rect) return null
        const holder = slot.picked ? pickedBy(compact, slot.i) : null
        const classes = ['hit', 'hit-ability']
        if (slot.picked) classes.push('is-picked')
        if (!slot.name) classes.push('is-unknown')
        if (selectedIndex === slot.i) classes.push('is-selected')
        else if (partners.strong.has(slot.i)) classes.push('is-partner-strong')
        else if (partners.weak.has(slot.i)) classes.push('is-partner-weak')
        const title = slot.name
          ? `${displayName(rich, catalog, slot.name, slot.i)}${
              holder !== null ? ` — picked by ${playerName(compact, rich, holder) ?? `player ${holder + 1}`}` : ''
            }`
          : 'Unknown ability'
        return (
          <button
            key={slot.i}
            type="button"
            className={classes.join(' ')}
            style={style(rect)}
            title={title}
            disabled={!slot.name}
            onClick={() => select(selectedIndex === slot.i ? null : { kind: 'ability', i: slot.i })}
          />
        )
      })}
      {modelRects.map((rect, heroOrder) => {
        if (!rect) return null
        const cdn = compact.pool?.[heroOrder]?.[0] ?? null
        const picked = isModelPicked(compact, heroOrder)
        const classes = ['hit', 'hit-hero']
        if (picked) classes.push('is-picked')
        if (selection?.kind === 'hero' && selection.heroOrder === heroOrder) classes.push('is-selected')
        return (
          <button
            key={`hero-${heroOrder}`}
            type="button"
            className={classes.join(' ')}
            style={style(rect)}
            title={`${heroDisplayName(rich, catalog, cdn, heroOrder)}${picked ? ' — model picked' : ''}`}
            onClick={() =>
              select(
                selection?.kind === 'hero' && selection.heroOrder === heroOrder
                  ? null
                  : { kind: 'hero', heroOrder },
              )
            }
          />
        )
      })}
    </div>
  )
}
