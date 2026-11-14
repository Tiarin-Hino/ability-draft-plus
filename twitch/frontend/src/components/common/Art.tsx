import { useState } from 'react'
import { abilityCdnUrl, heroCdnUrl, itemCdnUrl, portraitObjectPosition } from '../../data/icons'

export function AbilityIcon({ name, label, size = 40 }: { name: string | null; label: string; size?: number }) {
  const [failedName, setFailedName] = useState<string | null>(null)
  if (!name || failedName === name) {
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
      onError={() => setFailedName(name)}
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
  const [failedCdn, setFailedCdn] = useState<string | null>(null)
  if (!cdn || failedCdn === cdn) {
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
      onError={() => setFailedCdn(cdn)}
    />
  )
}

export function ItemIcon({ name, size = 28 }: { name: string | null; size?: number }) {
  const [failedName, setFailedName] = useState<string | null>(null)
  if (!name || failedName === name) {
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
      onError={() => setFailedName(name)}
    />
  )
}

export function pct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? 'N/A' : `${(value * 100).toFixed(digits)}%`
}
