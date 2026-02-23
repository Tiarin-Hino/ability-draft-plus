import { useState } from 'react'

export const PAGE_IDS = [
  'dashboard',
  'abilities',
  'heroes',
  'scraping',
  'settings',
  'mapper',
  'dev-mapper',
] as const

export type PageId = (typeof PAGE_IDS)[number]

export function useNavigation() {
  const [activePage, setActivePage] = useState<PageId>('dashboard')
  return { activePage, setActivePage }
}
