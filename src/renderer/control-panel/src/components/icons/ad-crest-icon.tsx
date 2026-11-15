// @DEV-GUIDE: Ability Draft Plus "3+1 Draft Loadout" brand mark — 3 framed standard ability
// sockets + 1 bold arcane-teal ultimate `+` node. Uses theme CSS tokens (`--color-primary` and
// `--color-brand-teal`) plus dark-variant socket fill so it adapts cleanly between Warm Alabaster
// Light and Arcane Obsidian Dark without duplicate SVG gradient IDs.

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
      <rect
        x="3"
        y="3"
        width="11"
        height="11"
        rx="2.2"
        className="fill-[#fffdf8] dark:fill-[#192230]"
        stroke="var(--color-primary)"
        strokeWidth="1.8"
      />
      <rect
        x="18"
        y="3"
        width="11"
        height="11"
        rx="2.2"
        className="fill-[#fffdf8] dark:fill-[#192230]"
        stroke="var(--color-primary)"
        strokeWidth="1.8"
      />
      <rect
        x="3"
        y="18"
        width="11"
        height="11"
        rx="2.2"
        className="fill-[#fffdf8] dark:fill-[#192230]"
        stroke="var(--color-primary)"
        strokeWidth="1.8"
      />
      <rect x="21.75" y="18" width="3.5" height="11" rx="0.7" fill="var(--color-brand-teal)" />
      <rect x="18" y="21.75" width="11" height="3.5" rx="0.7" fill="var(--color-brand-teal)" />
    </svg>
  )
}
