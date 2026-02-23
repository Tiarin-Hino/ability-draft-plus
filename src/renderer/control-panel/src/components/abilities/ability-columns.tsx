import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { AbilityDetail } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'

function pct(val: number | null): string {
  if (val === null) return '—'
  return `${(val * 100).toFixed(1)}%`
}

function rate(val: number | null): string {
  if (val === null) return '—'
  return val.toFixed(2)
}

export function useAbilityColumns(
  heroMap: Map<number, string>,
): ColumnDef<AbilityDetail>[] {
  return useMemo(
    () => [
      {
        accessorKey: 'displayName',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Name" />
        ),
        filterFn: 'includesString',
      },
      {
        accessorKey: 'heroId',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Hero" />
        ),
        cell: ({ row }) =>
          heroMap.get(row.original.heroId) ?? `Hero #${row.original.heroId}`,
      },
      {
        accessorKey: 'winrate',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Win Rate" />
        ),
        cell: ({ row }) => pct(row.original.winrate),
      },
      {
        accessorKey: 'highSkillWinrate',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="HS Win Rate" />
        ),
        cell: ({ row }) => pct(row.original.highSkillWinrate),
      },
      {
        accessorKey: 'pickRate',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Pick Rate" />
        ),
        cell: ({ row }) => rate(row.original.pickRate),
      },
      {
        accessorKey: 'isUltimate',
        header: 'Ultimate',
        cell: ({ row }) =>
          row.original.isUltimate ? (
            <Badge variant="secondary">Ult</Badge>
          ) : null,
        filterFn: (row, _id, filterValue) => {
          if (filterValue === undefined) return true
          return row.original.isUltimate === filterValue
        },
      },
    ],
    [heroMap],
  )
}
