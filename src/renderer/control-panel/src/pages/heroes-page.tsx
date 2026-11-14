import { useTranslation } from 'react-i18next'
import { DataTable } from '@/components/data-table/data-table'
import { useHeroColumns } from '@/components/statistics/hero-columns'
import { useIpcQuery } from '@/hooks/use-ipc-query'

export function HeroesPage() {
  const { t } = useTranslation('data')
  const columns = useHeroColumns()
  const { data, loading } = useIpcQuery('hero:getAll')

  if (loading) {
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
        data={data ?? []}
        searchKey="displayName"
        searchPlaceholder={t('heroes.filterPlaceholder')}
      />
    </div>
  )
}
