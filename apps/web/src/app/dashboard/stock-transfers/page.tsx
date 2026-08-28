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
import { StockTransferStatusBadge } from '@/features/stock-transfers/components/stock-transfer-status-badge';
import { stockTransfersApi } from '@/features/stock-transfers/api';
import { STOCK_TRANSFER_STATUS_LABELS } from '@/features/stock-transfers/labels';
import type { StockTransferStatus, StockTransferSummary } from '@/features/stock-transfers/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

const TRANSFER_ROLES = new Set(['ADMIN', 'MANAGER']);
const STATUSES = Object.keys(STOCK_TRANSFER_STATUS_LABELS) as StockTransferStatus[];

export default function StockTransfersPage(): React.JSX.Element {
  const { user } = useAuth();
  const canTransfer = TRANSFER_ROLES.has(user?.role ?? '');
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StockTransferStatus | ''>('');
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
    queryKey: ['stock-transfers', page, search, status],
    queryFn: () => stockTransfersApi.list({ page, search, status: status || undefined }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Stock transfers</h1>
          <p className="text-sm text-muted-foreground">Stock moving between locations, from request through to arrival.</p>
        </div>
        {canTransfer && (
          <Button
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            New transfer
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by transfer number or notes"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StockTransferStatus | '');
            setPage(1);
          }}
          className="max-w-48"
        >
          <option value="">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {STOCK_TRANSFER_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={TRANSFER_COLUMNS}
        rows={data?.items ?? []}
        rowKey={(transfer) => transfer.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No stock transfers found."
        onRowClick={(transfer) => {
          router.push(`/dashboard/stock-transfers/${transfer.id}`);
        }}
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />

      <NewStockTransferDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        onCreated={(id) => {
          router.push(`/dashboard/stock-transfers/${id}`);
        }}
      />
    </div>
  );
}

const TRANSFER_COLUMNS: DataTableColumn<StockTransferSummary>[] = [
  { key: 'transferNumber', label: 'Transfer', render: (transfer) => <span className="font-medium">{transfer.transferNumber}</span> },
  { key: 'source', label: 'From', render: (transfer) => <span className="text-muted-foreground">{transfer.sourceLocation.name}</span> },
  { key: 'destination', label: 'To', render: (transfer) => <span className="text-muted-foreground">{transfer.destinationLocation.name}</span> },
  { key: 'status', label: 'Status', render: (transfer) => <StockTransferStatusBadge status={transfer.status} /> },
  { key: 'items', label: 'Items', align: 'right', render: (transfer) => <span className="tabular-nums">{transfer._count.items}</span> },
  { key: 'created', label: 'Created', render: (transfer) => <span className="text-muted-foreground">{formatDateTime(transfer.createdAt)}</span> },
];

/** A transfer needs its two locations before it exists, so opening one is pick-then-create. */
function NewStockTransferDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="New stock transfer">
      {open && <NewStockTransferForm onClose={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function NewStockTransferForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createMutation = useMutation({ mutationFn: stockTransfersApi.create });

  const canCreate = sourceLocationId !== '' && destinationLocationId !== '' && sourceLocationId !== destinationLocationId;

  async function handleCreate(): Promise<void> {
    if (!canCreate) return;
    setError(null);
    try {
      const transfer = await createMutation.mutateAsync({ sourceLocationId, destinationLocationId });
      onClose();
      onCreated(transfer.id);
    } catch (submitError) {
      setError(errorMessage(submitError));
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="transfer-source">From</Label>
        <LocationSelect id="transfer-source" value={sourceLocationId} onChange={setSourceLocationId} excludeId={destinationLocationId} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="transfer-destination">To</Label>
        <LocationSelect id="transfer-destination" value={destinationLocationId} onChange={setDestinationLocationId} excludeId={sourceLocationId} />
      </div>

      {error !== null && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!canCreate || createMutation.isPending} onClick={() => void handleCreate()}>
          {createMutation.isPending ? 'Creating...' : 'Create draft'}
        </Button>
      </div>
    </div>
  );
}
