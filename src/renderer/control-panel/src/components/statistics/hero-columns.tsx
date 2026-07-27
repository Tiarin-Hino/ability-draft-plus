import type { ColumnDef } from '@tanstack/react-table'
import type { Hero } from '@shared/types'
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

export const heroColumns: ColumnDef<Hero>[] = [
  {
    accessorKey: 'displayName',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Hero" />
    ),
    filterFn: 'includesString',
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
    accessorKey: 'hsPickRate',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="HS Pick Rate" />
    ),
    cell: ({ row }) => rate(row.original.hsPickRate),
  },
]
