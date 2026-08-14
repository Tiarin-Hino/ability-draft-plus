import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// @DEV-GUIDE: ?edit=1 layout tuning mode. Every section carrying a data-edit-key
// attribute becomes draggable (move), wheel-scalable (resize; Alt = fine steps),
// and double-click-resettable. Transforms are visual-only (CSS transform, no
// layout reflow), persist in localStorage, and are ALWAYS applied on load — even
// without ?edit=1 — so a tuned browser view keeps its layout across refreshes.
// The panel shows the adjustments as JSON to copy-paste back to the developer,
// whose job is then to bake the numbers into stream.css as real layout. NOTE:
// localStorage is per-browser-profile — an OBS browser source does not see what
// was tuned in a desktop browser; this is a tuning tool, not a settings store.

export interface EditTransform {
  x: number
  y: number
  s: number
}
export type EditLayout = Record<string, EditTransform>

const STORAGE_KEY = 'adplus-stream-layout'
const IDENTITY: EditTransform = { x: 0, y: 0, s: 1 }

export function loadStoredLayout(): EditLayout {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as EditLayout
  } catch {
    return {}
  }
}

/** Stamp the stored transforms onto the current DOM (idempotent). */
export function applyLayout(layout: EditLayout): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-edit-key]')) {
    const t = layout[el.dataset.editKey as string]
    el.style.transform =
      t && (t.x !== 0 || t.y !== 0 || t.s !== 1)
        ? `translate(${t.x}px, ${t.y}px) scale(${t.s})`
        : ''
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * boardRev: bump on every board state update so transforms are re-stamped after
 * React re-renders the sections (inline styles on unmanaged attributes survive
 * reconciliation, but not element re-creation).
 */
interface Chip {
  key: string
  x: number
  y: number
}

export function EditMode({ boardRev }: { boardRev: number }) {
  const { t } = useTranslation()
  const [layout, setLayout] = useState<EditLayout>(loadStoredLayout)
  const [copied, setCopied] = useState(false)
  const [chips, setChips] = useState<Chip[]>([])
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null)
  const layoutRef = useRef(layout)

  // Label chips track each target's top-left corner (recomputed after drags,
  // scales, and board re-renders — they need not follow live during a drag)
  useEffect(() => {
    const compute = () =>
      setChips(
        [...document.querySelectorAll<HTMLElement>('[data-edit-key]')].map((el) => {
          const r = el.getBoundingClientRect()
          return { key: el.dataset.editKey as string, x: r.left + 4, y: r.top + 2 }
        }),
      )
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [layout, boardRev])

  useEffect(() => {
    layoutRef.current = layout
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
    applyLayout(layout)
  }, [layout])

  useEffect(() => {
    applyLayout(layoutRef.current)
  }, [boardRev])

  useEffect(() => {
    const targets = [...document.querySelectorAll<HTMLElement>('[data-edit-key]')]
    for (const el of targets) el.classList.add('edit-target')

    let drag: {
      key: string
      startX: number
      startY: number
      baseX: number
      baseY: number
    } | null = null

    const keyOf = (e: Event): string | null =>
      (e.target as HTMLElement).closest<HTMLElement>('[data-edit-key]')?.dataset
        .editKey ?? null

    const onPointerDown = (e: PointerEvent) => {
      const key = keyOf(e)
      if (!key || (e.target as HTMLElement).closest('.edit-panel')) return
      e.preventDefault()
      const base = layoutRef.current[key] ?? IDENTITY
      drag = { key, startX: e.clientX, startY: e.clientY, baseX: base.x, baseY: base.y }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return
      const { key, startX, startY, baseX, baseY } = drag
      setLayout((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? IDENTITY),
          x: round1(baseX + e.clientX - startX),
          y: round1(baseY + e.clientY - startY),
        },
      }))
    }
    const onPointerUp = () => {
      drag = null
    }
    const onWheel = (e: WheelEvent) => {
      const key = keyOf(e)
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
      const key = keyOf(e)
      if (!key) return
      e.preventDefault()
      setLayout((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }

    // Capture phase so the sections' own content never swallows the events
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('wheel', onWheel, { capture: true, passive: false })
    document.addEventListener('dblclick', onDblClick, true)
    return () => {
      for (const el of targets) el.classList.remove('edit-target')
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('wheel', onWheel, true)
      document.removeEventListener('dblclick', onDblClick, true)
    }
  }, [])

  const entries = Object.entries(layout)
  const json = JSON.stringify(layout)

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
  // section it happens to cover
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
    <>
      <div className="edit-chips" aria-hidden="true">
        {chips.map((chip) => (
          <span key={chip.key} className="edit-chip" style={{ left: chip.x, top: chip.y }}>
            {chip.key}
          </span>
        ))}
      </div>
      <aside
        className="edit-panel"
        style={panelPos ? { left: panelPos.x, top: panelPos.y, bottom: 'auto' } : undefined}
      >
      <div className="edit-panel-title" onPointerDown={dragPanel}>{t('edit.title')}</div>
      <div className="edit-panel-hint">{t('edit.hintMove')}</div>
      <div className="edit-panel-hint">{t('edit.hintScale')}</div>
      <div className="edit-panel-hint">{t('edit.hintReset')}</div>
      {entries.length > 0 ? (
        <>
          <div className="edit-panel-list">
            {entries.map(([key, tr]) => (
              <div key={key} className="edit-panel-row">
                <span className="edit-panel-key">{key}</span>
                <span className="edit-panel-values">
                  {tr.x}, {tr.y} × {tr.s}
                </span>
              </div>
            ))}
          </div>
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
      ) : (
        <div className="edit-panel-hint edit-panel-empty">{t('edit.empty')}</div>
      )}
      </aside>
    </>
  )
}
