import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
export { nextSortState } from './data-table-sort';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Omit for a column the backend has no whitelisted sort field for. */
  sortable?: boolean;
  className?: string;
  render: (item: T) => React.ReactNode;
}

export interface DataTableSort {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSortChange: (sortBy: string) => void;
}

export interface DataTablePagination {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (item: T) => string;
  isLoading: boolean;
  isError?: boolean;
  error?: unknown;
  emptyMessage: string;
  /** Omit for a table with no server-driven ordering. */
  sort?: DataTableSort;
  /** Omit for a table with a single page of results. */
  pagination?: DataTablePagination;
  onRowClick?: (item: T) => void;
}

/**
 * The shared shell every list page's table wants: consistent loading/error/
 * empty states, optional server-driven sort (click a sortable header) and
 * pagination - so a page's own code is just its columns and row renderer,
 * not another hand-rolled `<table>`.
 *
 * Row selection, bulk actions, column visibility and saved views are
 * deliberately not here yet - real features, not free with a table shell,
 * and no page needs them today. Add them to this component (not a fork of
 * it) the first time a page actually does.
 */
export function DataTable<T>({ columns, rows, rowKey, isLoading, isError = false, error, emptyMessage, sort, pagination, onRowClick }: DataTableProps<T>): React.JSX.Element {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          {isLoading && <TableSkeleton />}
          {isError && <p className="p-4 text-sm text-danger">{errorMessage(error)}</p>}
          {!isLoading && !isError && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    {columns.map((column) => (
                      <th key={column.key} className={cn('p-3 font-medium', column.align === 'right' && 'text-right')}>
                        {column.sortable === true && sort !== undefined ? (
                          <button
                            type="button"
                            onClick={() => {
                              sort.onSortChange(column.key);
                            }}
                            className={cn(
                              'inline-flex items-center gap-1 transition-colors hover:text-foreground',
                              column.align === 'right' && 'flex-row-reverse',
                              sort.sortBy === column.key && 'text-foreground',
                            )}
                          >
                            {column.label}
                            <SortIcon active={sort.sortBy === column.key} order={sort.sortOrder} />
                          </button>
                        ) : (
                          column.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length} className="p-4 text-center text-muted-foreground">
                        {emptyMessage}
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <tr
                      key={rowKey(row)}
                      className={cn('border-b border-border last:border-0', onRowClick !== undefined && 'cursor-pointer hover:bg-muted')}
                      onClick={onRowClick === undefined ? undefined : () => { onRowClick(row); }}
                    >
                      {columns.map((column) => (
                        <td key={column.key} className={column.className ?? cn('p-3', column.align === 'right' && 'text-right')}>
                          {column.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {pagination !== undefined && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {pagination.page} of {pagination.totalPages} &middot; {pagination.total} total
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => {
                pagination.onPageChange(pagination.page - 1);
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => {
                pagination.onPageChange(pagination.page + 1);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortIcon({ active, order }: { active: boolean; order: 'asc' | 'desc' }): React.JSX.Element {
  if (!active) {
    return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  }
  return order === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}
