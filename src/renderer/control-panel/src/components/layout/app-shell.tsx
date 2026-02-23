import type { ReactNode } from 'react'

// @DEV-GUIDE: Discord-style layout shell for the control panel window.
// Structure: fixed-width sidebar (6 nav items) on the left, with a vertical stack on the right
// containing: header bar (language dropdown + page title), optional update banner, and
// scrollable content area. All layout is CSS flexbox, h-screen with overflow-hidden.

interface AppShellProps {
  sidebar: ReactNode
  header: ReactNode
  banner?: ReactNode
  children: ReactNode
}

export function AppShell({ sidebar, header, banner, children }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {sidebar}
      <div className="flex flex-1 flex-col overflow-hidden">
        {header}
        {banner}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
