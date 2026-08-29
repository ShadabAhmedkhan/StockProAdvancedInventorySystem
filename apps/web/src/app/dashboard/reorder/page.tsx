'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { reorderApi } from '@/features/products/api';
import type { ReorderSuggestion } from '@/features/products/types';

export default function ReorderPage(): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [needsReorderOnly, setNeedsReorderOnly] = useState(true);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reorder-suggestions', page, needsReorderOnly],
    queryFn: () => reorderApi.list({ page, needsReorderOnly }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Reorder suggestions</h1>
        <p className="text-sm text-muted-foreground">
          Deterministic suggestions for products with a reorder point configured - available and incoming stock projected against the reorder point, with a
          quantity to bring stock back up to target.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={needsReorderOnly}
          onChange={(event) => {
            setNeedsReorderOnly(event.target.checked);
            setPage(1);
          }}
        />
        Only show products that need reordering now
      </label>

      <DataTable
        columns={REORDER_COLUMNS}
        rows={data?.items ?? []}
        rowKey={(row) => row.productId}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No products need reordering right now. Set a reorder point on a product to include it here."
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />
    </div>
  );
}

const REORDER_COLUMNS: DataTableColumn<ReorderSuggestion>[] = [
  {
    key: 'product',
    label: 'Product',
    render: (row) => (
      <div>
        <p className="font-medium">{row.name}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.sku}</p>
      </div>
    ),
  },
  { key: 'available', label: 'Available', align: 'right', render: (row) => <span className="tabular-nums">{row.availableStock}</span> },
  { key: 'incoming', label: 'Incoming', align: 'right', render: (row) => <span className="tabular-nums">{row.incomingStock}</span> },
  { key: 'demand', label: 'Avg. daily demand', align: 'right', render: (row) => <span className="tabular-nums">{row.averageDailyDemand}</span> },
  { key: 'reorderPoint', label: 'Reorder point', align: 'right', render: (row) => <span className="tabular-nums">{row.reorderPoint}</span> },
  { key: 'targetStock', label: 'Target', align: 'right', render: (row) => <span className="tabular-nums">{row.targetStock}</span> },
  { key: 'leadTime', label: 'Lead time', align: 'right', render: (row) => <span className="tabular-nums">{row.leadTimeDays ?? '—'}</span> },
  { key: 'supplier', label: 'Preferred supplier', render: (row) => row.preferredSupplierName ?? '—' },
  {
    key: 'suggested',
    label: 'Suggested reorder qty',
    align: 'right',
    render: (row) => (
      <span className={`tabular-nums font-medium ${row.suggestedReorderQuantity > 0 ? 'text-warning' : ''}`}>{row.suggestedReorderQuantity}</span>
    ),
  },
];
