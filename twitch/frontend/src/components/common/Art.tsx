import { useState } from 'react'
import { abilityCdnUrl, heroCdnUrl, itemCdnUrl, portraitObjectPosition } from '../../data/icons'

export function AbilityIcon({ name, label, size = 40 }: { name: string | null; label: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (!name || failed) {
    return (
      <span className="art art-fallback" style={{ width: size, height: size }} aria-hidden="true">
        {label.charAt(0)}
      </span>
    )
  }
  return (
    <img
      className="art"
      src={abilityCdnUrl(name)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

export function HeroPortrait({
  cdn,
  label,
  width = 64,
  height = 36,
}: {
  cdn: string | null
  label: string
  width?: number
  height?: number
}) {
  const [failed, setFailed] = useState(false)
  if (!cdn || failed) {
    return (
      <span className="art art-fallback art-portrait" style={{ width, height }} aria-hidden="true">
        {cdn ? label.charAt(0) : '?'}
      </span>
    )
  }
  return (
    <img
      className="art art-portrait"
      src={heroCdnUrl(cdn)}
      alt=""
      width={width}
      height={height}
      style={{ objectPosition: portraitObjectPosition(cdn) }}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

export function ItemIcon({ name, size = 28 }: { name: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (!name || failed) {
    return (
      <span className="art art-item art-empty" style={{ width: size * 1.33, height: size }} aria-hidden="true" />
    )
  }
  return (
    <img
      className="art art-item"
      src={itemCdnUrl(name)}
      alt=""
      title={name.replace(/_/g, ' ')}
      width={size * 1.33}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

export function pct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? 'N/A' : `${(value * 100).toFixed(digits)}%`
}
