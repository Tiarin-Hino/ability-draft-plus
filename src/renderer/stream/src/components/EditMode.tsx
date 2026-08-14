import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// @DEV-GUIDE: ?edit=1 layout tuning mode. Editing works on element TYPES, not
// individual elements: adjusting any pool tile adjusts every pool tile, dragging
// one player name moves all ten, etc. Interactions: drag = move the type, mouse
// wheel = scale it (Alt = fine steps), double-click = reset it. Two symmetry
// rules keep the board broadcast-clean: horizontal moves MIRROR across the
// radiant/dire sides (stored x is the LEFT-side value; dragging a right-side
// instance inverts the delta so the dragged element follows the cursor), and
// scaling a tile type also widens its containers' flex gap so tiles spread
// instead of overlapping. Everything lands in ONE injected <style> tag keyed by
// the selectors below — it survives React re-renders, persists in localStorage,
// and is applied on load even without ?edit=1. The panel shows the values as
// JSON to copy back to the developer, whose job is to bake them into stream.css
// as real sizes/offsets. NOTE: localStorage is per-browser-profile — an OBS
// browser source does not see what was tuned in a desktop browser.

export interface EditTransform {
  x: number
  y: number
  s: number
}
export type EditLayout = Record<string, EditTransform>

interface GapDef {
  /** Flex container whose gap must grow with the scale. */
  selector: string
  /** The container's authored gap (rem). */
  baseGap: number
  /** The scaled element's base size along the row axis (rem). */
  baseSize: number
}

interface GroupDef {
  key: string
  /** Every instance (event hit-testing + un-mirrored rule). */
  selector: string
  /** Set on side-mirrored types: left instances get +x, right instances -x. */
  left?: string
  right?: string
  /** Containers whose gap absorbs the scale so instances don't overlap. */
  gaps?: GapDef[]
}

/** Pool ability tiles are tuned as MIRRORED PAIRS, decoupled from each other:
 * every tile pairs only with its geometric twin on the opposite side, so
 * position and size can roam freely per pair while the board stays symmetric.
 * Standard rows: half-row children are [portrait, t1, t2, t3] on the left and
 * [t1, t2, t3, portrait] on the right, so pair c (1 = outermost) is left
 * nth-child(1+c) vs right nth-child(4-c). Ultimate rows are 6 tiles wide, so
 * pair c is nth-child(c) vs nth-child(7-c). */
function poolPairGroups(): GroupDef[] {
  const groups: GroupDef[] = []
  for (let r = 1; r <= 6; r++) {
    for (let c = 1; c <= 3; c++) {
      const row = `.pool-standard .pool-std-row:nth-child(${r})`
      const left = `${row} .pool-half-left .tile:nth-child(${1 + c})`
      const right = `${row} .pool-half-right .tile:nth-child(${4 - c})`
      groups.push({ key: `pool-std-r${r}-c${c}`, selector: `${left}, ${right}`, left, right })
    }
  }
  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= 3; c++) {
      const row = `.pool-ultimates .pool-ult-row:nth-child(${r})`
      const left = `${row} .tile:nth-child(${c})`
      const right = `${row} .tile:nth-child(${7 - c})`
      groups.push({ key: `pool-ult-r${r}-c${c}`, selector: `${left}, ${right}`, left, right })
    }
  }
  return groups
}

/** The tunable element types. Order matters: the first selector that contains
 * the event target wins, so more specific contexts must precede generic ones. */
const GROUPS: GroupDef[] = [
  {
    key: 'top-winrate-ability',
    selector: '.panel-tiles .top-winrate-entry',
    gaps: [{ selector: '.panel-tiles', baseGap: 0.45, baseSize: 3.05 }],
  },
  { key: 'combo-pair', selector: '.combo-entry' },
  {
    key: 'card-ability',
    selector: '.player-picks .tile',
    left: '.team-radiant .player-picks .tile',
    right: '.team-dire .player-picks .tile',
    gaps: [{ selector: '.player-picks', baseGap: 0.32, baseSize: 3.05 }],
  },
  {
    key: 'hero-name',
    selector: '.player-hero-line',
    left: '.team-radiant .player-hero-line',
    right: '.team-dire .player-hero-line',
  },
  {
    key: 'player-name',
    selector: '.player-name-line',
    left: '.team-radiant .player-name-line',
    right: '.team-dire .player-name-line',
  },
  {
    key: 'pool-hero',
    selector: '.pool-hero-mini',
    left: '.pool-half-left .pool-hero-mini',
    right: '.pool-half-right .pool-hero-mini',
  },
  ...poolPairGroups(),
]

const KNOWN_KEYS = new Set(GROUPS.map((g) => g.key))

const STORAGE_KEY = 'adplus-stream-layout'
const STYLE_ID = 'edit-layout-style'
const IDENTITY: EditTransform = { x: 0, y: 0, s: 1 }

export function loadStoredLayout(): EditLayout {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as EditLayout
  } catch {
    return {}
  }
}

/** Materialize the layout as one injected stylesheet (idempotent). */
export function applyLayout(layout: EditLayout): void {
  let style = document.getElementById(STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  const rules: string[] = []
  for (const g of GROUPS) {
    const t = layout[g.key]
    if (!t || (t.x === 0 && t.y === 0 && t.s === 1)) continue
    if (g.left && g.right && t.x !== 0) {
      rules.push(
        `${g.left} { transform: translate(${t.x}px, ${t.y}px) scale(${t.s}); }`,
        `${g.right} { transform: translate(${-t.x}px, ${t.y}px) scale(${t.s}); }`,
      )
    } else {
      rules.push(`${g.selector} { transform: translate(${t.x}px, ${t.y}px) scale(${t.s}); }`)
    }
    if (t.s !== 1 && g.gaps) {
      // A scaled element still occupies its unscaled layout box, so neighbors
      // encroach by baseSize*(s-1); grow the gap proportionally AND absorb the
      // overlap, clamped at zero for downscales
      for (const gap of g.gaps) {
        rules.push(
          `${gap.selector} { gap: max(0px, calc(${gap.baseGap}rem * ${t.s} + ${gap.baseSize}rem * ${t.s - 1})); }`,
        )
      }
    }
  }
  style.textContent = rules.join('\n')
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function EditMode() {
  const { t } = useTranslation()
  const [layout, setLayout] = useState<EditLayout>(loadStoredLayout)
  const [hovered, setHovered] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null)
  const layoutRef = useRef(layout)

  useEffect(() => {
    layoutRef.current = layout
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
    applyLayout(layout)
  }, [layout])

  useEffect(() => {
    document.body.classList.add('edit-active')

    // Hover highlighting for every group (incl. the generated pool pairs) —
    // one rule per group keyed off body[data-edit-hover]
    const hoverStyle = document.createElement('style')
    hoverStyle.id = 'edit-hover-style'
    hoverStyle.textContent = GROUPS.map(
      (g) =>
        `body[data-edit-hover='${g.key}'] :is(${g.selector}) { outline: 2px solid var(--gold); outline-offset: 1px; }`,
    ).join('\n')
    document.head.appendChild(hoverStyle)

    const groupOf = (e: Event): GroupDef | null => {
      const el = e.target as HTMLElement
      if (el.closest('.edit-panel')) return null
      for (const g of GROUPS) {
        if (el.closest(g.selector)) return g
      }
      return null
    }

    let drag: {
      key: string
      /** -1 when a right-side instance is dragged: stored x is the LEFT-side
       * value, so the delta inverts to keep the dragged element under the
       * cursor while the other side mirrors. */
      xFactor: number
      startX: number
      startY: number
      baseX: number
      baseY: number
    } | null = null

    const onPointerDown = (e: PointerEvent) => {
      const group = groupOf(e)
      if (!group) return
      e.preventDefault()
      const base = layoutRef.current[group.key] ?? IDENTITY
      const onRightSide =
        group.right !== undefined &&
        (e.target as HTMLElement).closest(group.right) !== null
      drag = {
        key: group.key,
        xFactor: onRightSide ? -1 : 1,
        startX: e.clientX,
        startY: e.clientY,
        baseX: base.x,
        baseY: base.y,
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (drag) {
        const { key, xFactor, startX, startY, baseX, baseY } = drag
        setLayout((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] ?? IDENTITY),
            x: round1(baseX + (e.clientX - startX) * xFactor),
            y: round1(baseY + e.clientY - startY),
          },
        }))
      } else {
        const key = groupOf(e)?.key ?? null
        setHovered(key)
        if (key) document.body.dataset.editHover = key
        else delete document.body.dataset.editHover
      }
    }
    const onPointerUp = () => {
      drag = null
    }
    const onWheel = (e: WheelEvent) => {
      const key = groupOf(e)?.key
      if (!key) return
      e.preventDefault()
      const step = (e.altKey ? 0.01 : 0.05) * (e.deltaY < 0 ? 1 : -1)
      setLayout((prev) => {
        const cur = prev[key] ?? IDENTITY
        const s = Math.min(3, Math.max(0.3, Math.round((cur.s + step) * 100) / 100))
        return { ...prev, [key]: { ...cur, s } }
      })
    }
    const onDblClick = (e: MouseEvent) => {
      const key = groupOf(e)?.key
      if (!key) return
      e.preventDefault()
      setLayout((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }

    // Capture phase so the elements' own content never swallows the events
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('wheel', onWheel, { capture: true, passive: false })
    document.addEventListener('dblclick', onDblClick, true)
    return () => {
      document.body.classList.remove('edit-active')
      delete document.body.dataset.editHover
      hoverStyle.remove()
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('wheel', onWheel, true)
      document.removeEventListener('dblclick', onDblClick, true)
    }
  }, [])

  const adjusted = Object.fromEntries(
    Object.entries(layout).filter(
      ([key, tr]) => KNOWN_KEYS.has(key) && (tr.x !== 0 || tr.y !== 0 || tr.s !== 1),
    ),
  )
  const json = JSON.stringify(adjusted)
  const hasAdjustments = Object.keys(adjusted).length > 0

  const copy = () => {
    void navigator.clipboard
      ?.writeText(json)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        /* clipboard unavailable — the textarea below stays selectable */
      })
  }

  // The panel itself is draggable by its title so it can be moved off whatever
  // it happens to cover
  const dragPanel = (e: React.PointerEvent) => {
    e.preventDefault()
    const panel = (e.target as HTMLElement).closest<HTMLElement>('.edit-panel')
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const offX = e.clientX - rect.left
    const offY = e.clientY - rect.top
    const onMove = (ev: PointerEvent) =>
      setPanelPos({ x: ev.clientX - offX, y: ev.clientY - offY })
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <aside
      className="edit-panel"
      style={panelPos ? { left: panelPos.x, top: panelPos.y, bottom: 'auto' } : undefined}
    >
      <div className="edit-panel-title" onPointerDown={dragPanel}>
        {t('edit.title')}
      </div>
      <div className="edit-panel-hint">{t('edit.hintType')}</div>
      <div className="edit-panel-hint">{t('edit.hintMirror')}</div>
      <div className="edit-panel-hint">{t('edit.hintMove')}</div>
      <div className="edit-panel-hint">{t('edit.hintScale')}</div>
      <div className="edit-panel-hint">{t('edit.hintReset')}</div>
      {/* 30 groups (24 of them pool pairs) would flood a full list: show the
          hovered group live, plus only the touched entries */}
      <div className="edit-panel-list">
        <div className="edit-panel-row edit-panel-row-hovered">
          <span className="edit-panel-key">{hovered ?? '—'}</span>
          {hovered && (
            <span className="edit-panel-values">
              {(layout[hovered] ?? IDENTITY).x}, {(layout[hovered] ?? IDENTITY).y} ×{' '}
              {(layout[hovered] ?? IDENTITY).s}
            </span>
          )}
        </div>
        {Object.entries(adjusted).map(([key, tr]) => (
          <div key={key} className="edit-panel-row">
            <span className="edit-panel-key">{key}</span>
            <span className="edit-panel-values">
              {tr.x}, {tr.y} × {tr.s}
            </span>
          </div>
        ))}
      </div>
      {hasAdjustments && (
        <>
          <textarea className="edit-panel-json" readOnly value={json} rows={3} />
          <div className="edit-panel-actions">
            <button type="button" onClick={copy}>
              {copied ? t('edit.copied') : t('edit.copy')}
            </button>
            <button type="button" onClick={() => setLayout({})}>
              {t('edit.resetAll')}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
