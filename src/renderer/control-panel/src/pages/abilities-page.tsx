import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTable } from '@/components/data-table/data-table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAbilityColumns } from '@/components/abilities/ability-columns'
import { useIpcQuery } from '@/hooks/use-ipc-query'

type UltimateFilter = 'all' | 'ult' | 'std'

export function AbilitiesPage() {
  const { t } = useTranslation('data')
  const { data: abilities, loading: abilitiesLoading } = useIpcQuery('ability:getAll')
  const { data: heroes, loading: heroesLoading } = useIpcQuery('hero:getAll')
  const [ultFilter, setUltFilter] = useState<UltimateFilter>('all')

  const heroMap = useMemo(() => {
    if (!heroes) return new Map<number, string>()
    return new Map(heroes.map((h) => [h.heroId, h.displayName]))
  }, [heroes])

  const filteredData = useMemo(() => {
    const base = abilities?.filter((a) => a.heroId !== 0) ?? []
    if (ultFilter === 'ult') return base.filter((a) => a.isUltimate)
    if (ultFilter === 'std') return base.filter((a) => !a.isUltimate)
    return base
  }, [abilities, ultFilter])

  const columns = useAbilityColumns(heroMap)

  if (abilitiesLoading || heroesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={filteredData}
        searchKey="displayName"
        searchPlaceholder={t('abilities.filterPlaceholder')}
        noResultsText={t('abilities.noResults')}
        initialSorting={[{ id: 'winrate', desc: true }]}
        toolbarExtra={
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label={t('abilities.columns.ultimate')}
          >
            {(['all', 'ult', 'std'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={ultFilter === mode ? 'default' : 'outline'}
                className="h-8 px-2.5 text-xs"
                onClick={() => setUltFilter(mode)}
              >
                {t(
                  mode === 'all'
                    ? 'abilities.filterAll'
                    : mode === 'ult'
                      ? 'abilities.filterUltimates'
                      : 'abilities.filterStandard',
                )}
              </Button>
            ))}
          </div>
        }
      />
    </div>
  )
}
