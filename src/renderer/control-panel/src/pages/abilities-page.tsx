import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTable } from '@/components/data-table/data-table'
import { useAbilityColumns } from '@/components/abilities/ability-columns'
import { useIpcQuery } from '@/hooks/use-ipc-query'

export function AbilitiesPage() {
  const { t } = useTranslation('data')
  const { data: abilities, loading: abilitiesLoading } = useIpcQuery('ability:getAll')
  const { data: heroes, loading: heroesLoading } = useIpcQuery('hero:getAll')

  const heroMap = useMemo(() => {
    if (!heroes) return new Map<number, string>()
    return new Map(heroes.map((h) => [h.heroId, h.displayName]))
  }, [heroes])

  const columns = useAbilityColumns(heroMap)

  if (abilitiesLoading || heroesLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-96 bg-muted animate-pulse rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={abilities?.filter((a) => a.heroId !== 0) ?? []}
        searchKey="displayName"
        searchPlaceholder={t('abilities.filterPlaceholder')}
      />
    </div>
  )
}
