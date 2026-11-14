import type { ReactNode } from 'react'
import type { Table } from '@tanstack/react-table'
import { Input } from '@/components/ui/input'

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  searchKey?: string
  searchPlaceholder?: string
  toolbarExtra?: ReactNode
}

export function DataTableToolbar<TData>({
  table,
  searchKey,
  searchPlaceholder,
  toolbarExtra,
}: DataTableToolbarProps<TData>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {searchKey && (
        <Input
          placeholder={searchPlaceholder ?? `Filter...`}
          value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ''}
          onChange={(e) => table.getColumn(searchKey)?.setFilterValue(e.target.value)}
          className="max-w-sm h-8"
        />
      )}
      {toolbarExtra}
    </div>
  )
}
