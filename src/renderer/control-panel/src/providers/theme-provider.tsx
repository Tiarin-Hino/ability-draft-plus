import { useEffect, type ReactNode } from 'react'
import { useAppStore } from '../hooks/use-app-store'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const resolvedDarkMode = useAppStore((s) => s.resolvedDarkMode)

  useEffect(() => {
    const root = document.documentElement
    if (resolvedDarkMode) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [resolvedDarkMode])

  return <>{children}</>
}
