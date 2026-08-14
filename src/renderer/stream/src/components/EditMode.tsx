import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// @DEV-GUIDE: ?edit=1 layout tuning mode. Editing works on element TYPES, not
// individual elements: adjusting any pool tile adjusts every pool tile, dragging
// one player name moves all ten, etc. Interactions: drag = move the type, mouse
// wheel = scale it (Alt = fine steps), double-click = reset it. Transforms are
// applied through ONE injected <style> tag keyed by the selectors below — they
// survive React re-renders untouched, persist in localStorage, and are applied
// on load even without ?edit=1. The panel shows the values as JSON to copy back
// to the developer, whose job is then to bake them into stream.css as real
// sizes/offsets. NOTE: localStorage is per-browser-profile — an OBS browser
// source does not see what was tuned in a desktop browser.

export interface EditTransform {
  x: number
  y: number
  s: number
}
export type EditLayout = Record<string, EditTransform>

/** The tunable element types. Order matters: the first selector that contains
 * the event target wins, so more specific contexts must precede generic ones. */
const GROUPS: Array<{ key: string; selector: string }> = [
  { key: 'top-winrate-ability', selector: '.panel-tiles .top-winrate-entry' },
  { key: 'combo-pair', selector: '.combo-entry' },
  { key: 'card-ability', selector: '.player-picks .tile' },
  { key: 'hero-name', selector: '.player-hero-line' },
  { key: 'player-name', selector: '.player-name-line' },
  { key: 'pool-hero', selector: '.pool-hero-mini' },
  { key: 'pool-ability', selector: '.pool-board .tile' },
]

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
  style.textContent = GROUPS.filter((g) => {
    const t = layout[g.key]
    return t && (t.x !== 0 || t.y !== 0 || t.s !== 1)
  })
    .map((g) => {
      const t = layout[g.key]
      return `${g.selector} { transform: translate(${t.x}px, ${t.y}px) scale(${t.s}); }`
    })
    .join('\n')
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

    const groupOf = (e: Event): string | null => {
      const el = e.target as HTMLElement
      if (el.closest('.edit-panel')) return null
      for (const g of GROUPS) {
        if (el.closest(g.selector)) return g.key
      }
      return null
    }

    let drag: {
      key: string
      startX: number
      startY: number
      baseX: number
      baseY: number
    } | null = null

    const onPointerDown = (e: PointerEvent) => {
      const key = groupOf(e)
      if (!key) return
      e.preventDefault()
      const base = layoutRef.current[key] ?? IDENTITY
      drag = { key, startX: e.clientX, startY: e.clientY, baseX: base.x, baseY: base.y }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (drag) {
        const { key, startX, startY, baseX, baseY } = drag
        setLayout((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] ?? IDENTITY),
            x: round1(baseX + e.clientX - startX),
            y: round1(baseY + e.clientY - startY),
          },
        }))
      } else {
        const key = groupOf(e)
        setHovered(key)
        if (key) document.body.dataset.editHover = key
        else delete document.body.dataset.editHover
      }
    }
    const onPointerUp = () => {
      drag = null
    }
    const onWheel = (e: WheelEvent) => {
      const key = groupOf(e)
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
      const key = groupOf(e)
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
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('wheel', onWheel, true)
      document.removeEventListener('dblclick', onDblClick, true)
    }
  }, [])

  const adjusted = Object.fromEntries(
    Object.entries(layout).filter(([, tr]) => tr.x !== 0 || tr.y !== 0 || tr.s !== 1),
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
      <div className="edit-panel-hint">{t('edit.hintMove')}</div>
      <div className="edit-panel-hint">{t('edit.hintScale')}</div>
      <div className="edit-panel-hint">{t('edit.hintReset')}</div>
      <div className="edit-panel-list">
        {GROUPS.map(({ key }) => {
          const tr = layout[key] ?? IDENTITY
          const touched = tr.x !== 0 || tr.y !== 0 || tr.s !== 1
          return (
            <div
              key={key}
              className={`edit-panel-row${hovered === key ? ' edit-panel-row-hovered' : ''}`}
            >
              <span className="edit-panel-key">{key}</span>
              <span className={`edit-panel-values${touched ? '' : ' edit-panel-values-idle'}`}>
                {tr.x}, {tr.y} × {tr.s}
              </span>
            </div>
          )
        })}
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
