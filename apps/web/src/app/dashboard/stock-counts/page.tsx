'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { LocationSelect } from '@/features/stock-transfers/components/location-select';
import { stockCountsApi } from '@/features/stock-counts/api';
import { StockCountStatusBadge } from '@/features/stock-counts/components/stock-count-status-badge';
import { STOCK_COUNT_STATUS_LABELS } from '@/features/stock-counts/labels';
import type { StockCountStatus, StockCountSummary } from '@/features/stock-counts/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

const COUNT_ROLES = new Set(['ADMIN', 'MANAGER']);
const STATUSES = Object.keys(STOCK_COUNT_STATUS_LABELS) as StockCountStatus[];

export default function StockCountsPage(): React.JSX.Element {
  const { user } = useAuth();
  const canManage = COUNT_ROLES.has(user?.role ?? '');
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StockCountStatus | ''>('');
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => {
      clearTimeout(timeout);
    };
  }, [searchInput]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['stock-counts', page, search, status],
    queryFn: () => stockCountsApi.list({ page, search, status: status || undefined }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Stock counts</h1>
          <p className="text-sm text-muted-foreground">Physical counts, with blind entry and manager-approved variance adjustments.</p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            New count
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by count number or notes"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StockCountStatus | '');
            setPage(1);
          }}
          className="max-w-48"
        >
          <option value="">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {STOCK_COUNT_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={COUNT_COLUMNS}
        rows={data?.items ?? []}
        rowKey={(count) => count.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No stock counts found."
        onRowClick={(count) => {
          router.push(`/dashboard/stock-counts/${count.id}`);
        }}
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />

      <NewStockCountDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        onCreated={(id) => {
          router.push(`/dashboard/stock-counts/${id}`);
        }}
      />
    </div>
  );
}

const COUNT_COLUMNS: DataTableColumn<StockCountSummary>[] = [
  { key: 'countNumber', label: 'Count', render: (count) => <span className="font-medium">{count.countNumber}</span> },
  { key: 'location', label: 'Location', render: (count) => <span className="text-muted-foreground">{count.location.name}</span> },
  { key: 'status', label: 'Status', render: (count) => <StockCountStatusBadge status={count.status} /> },
  { key: 'items', label: 'Items', align: 'right', render: (count) => <span className="tabular-nums">{count._count.items}</span> },
  { key: 'created', label: 'Created', render: (count) => <span className="text-muted-foreground">{formatDateTime(count.createdAt)}</span> },
];

/** A count is opened against a location; items are chosen afterward on the detail page (all-at-location, or added one by one). */
function NewStockCountDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="New stock count">
      {open && <NewStockCountForm onClose={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function NewStockCountForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const [locationId, setLocationId] = useState('');
  const [countEverything, setCountEverything] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const createMutation = useMutation({ mutationFn: stockCountsApi.create });

  async function handleCreate(): Promise<void> {
    if (locationId === '') return;
    setError(null);
    try {
      // Omitting productIds tells the API to snapshot every active product already held at this location.
      const stockCount = await createMutation.mutateAsync({ locationId, productIds: countEverything ? undefined : [] });
      onClose();
      onCreated(stockCount.id);
    } catch (submitError) {
      setError(errorMessage(submitError));
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="count-location">Location</Label>
        <LocationSelect id="count-location" value={locationId} onChange={setLocationId} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={countEverything}
          onChange={(event) => {
            setCountEverything(event.target.checked);
          }}
        />
        Include every product already held at this location
      </label>

      {error !== null && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={locationId === '' || createMutation.isPending} onClick={() => void handleCreate()}>
          {createMutation.isPending ? 'Creating...' : 'Create draft'}
        </Button>
      </div>
    </div>
  );
}
