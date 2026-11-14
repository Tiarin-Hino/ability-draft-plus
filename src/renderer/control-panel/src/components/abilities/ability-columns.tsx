import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ColumnDef } from '@tanstack/react-table'
import type { AbilityDetail } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'

// Coerce defensively: v1-era databases stored some numerics as text, and a
// string here crashed the whole table ("val.toFixed is not a function", #77)
function pct(val: number | null): string {
  const n = typeof val === 'number' ? val : Number(val)
  if (val == null || Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function rate(val: number | null): string {
  const n = typeof val === 'number' ? val : Number(val)
  if (val == null || Number.isNaN(n)) return '—'
  return n.toFixed(2)
}

export function useAbilityColumns(heroMap: Map<number, string>): ColumnDef<AbilityDetail>[] {
  const { t } = useTranslation('data')
  return useMemo(
    () => [
      {
        accessorKey: 'displayName',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('abilities.columns.name')} />
        ),
        filterFn: 'includesString',
      },
      {
        accessorKey: 'heroId',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('abilities.columns.hero')} />
        ),
        cell: ({ row }) =>
          heroMap.get(row.original.heroId) ??
          `${t('abilities.columns.hero')} #${row.original.heroId}`,
      },
      {
        accessorKey: 'winrate',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('abilities.columns.winrate')} />
        ),
        cell: ({ row }) => pct(row.original.winrate),
      },
      {
        accessorKey: 'highSkillWinrate',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('abilities.columns.hsWinrate')} />
        ),
        cell: ({ row }) => pct(row.original.highSkillWinrate),
      },
      {
        accessorKey: 'pickRate',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('abilities.columns.pickRate')} />
        ),
        cell: ({ row }) => rate(row.original.pickRate),
      },
      {
        accessorKey: 'isUltimate',
        header: () => t('abilities.columns.ultimate'),
        cell: ({ row }) =>
          row.original.isUltimate ? (
            <Badge variant="secondary">{t('abilities.columns.ultimate')}</Badge>
          ) : null,
        filterFn: (row, _id, filterValue) => {
          if (filterValue === undefined) return true
          return row.original.isUltimate === filterValue
        },
      },
    ],
    [heroMap, t],
  )
}
