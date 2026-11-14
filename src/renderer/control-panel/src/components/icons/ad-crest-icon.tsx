// @DEV-GUIDE: Custom Ability Draft Plus brand mark (faceted arcane shield + gold prism core).
// Renders cleanly across Warm Alabaster Light and Arcane Obsidian Dark sidebar headers.

interface AdCrestIconProps {
  className?: string
}

export function AdCrestIcon({ className = 'h-6 w-6' }: AdCrestIconProps): React.ReactElement {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="adCrestShield"
          x1="4"
          y1="3"
          x2="28"
          y2="29"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#1e2938" />
          <stop offset="100%" stopColor="#0f141c" />
        </linearGradient>
        <linearGradient
          id="adCrestGold"
          x1="7"
          y1="5"
          x2="25"
          y2="27"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f3d47d" />
          <stop offset="55%" stopColor="#d4ad56" />
          <stop offset="100%" stopColor="#9c7322" />
        </linearGradient>
        <linearGradient
          id="adCrestCore"
          x1="16"
          y1="8"
          x2="16"
          y2="23"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#46e0be" />
          <stop offset="100%" stopColor="#1c8f78" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5L27 6.8V15.4C27 22.1 22.2 27.3 16 29.5C9.8 27.3 5 22.1 5 15.4V6.8L16 2.5Z"
        fill="url(#adCrestShield)"
        stroke="url(#adCrestGold)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M16 6.2L22.5 13.5L16 24.2L9.5 13.5L16 6.2Z"
        fill="url(#adCrestCore)"
        fillOpacity="0.92"
        stroke="url(#adCrestGold)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M16 6.2V24.2M9.5 13.5H22.5"
        stroke="#f8e8b0"
        strokeOpacity="0.7"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}
