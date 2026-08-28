'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { purchaseOrdersApi } from '@/features/purchase-orders/api';
import { PurchaseOrderStatusBadge } from '@/features/purchase-orders/components/purchase-order-status-badge';
import { SupplierPicker } from '@/features/purchase-orders/components/supplier-picker';
import { PURCHASE_ORDER_STATUS_LABELS } from '@/features/purchase-orders/labels';
import type { PurchaseOrderStatus, PurchaseOrderSummary } from '@/features/purchase-orders/types';
import type { Supplier } from '@/features/suppliers/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatDateTime } from '@/lib/format';

const PURCHASE_ROLES = new Set(['ADMIN', 'MANAGER']);
const STATUSES = Object.keys(PURCHASE_ORDER_STATUS_LABELS) as PurchaseOrderStatus[];

export default function PurchaseOrdersPage(): React.JSX.Element {
  const { user } = useAuth();
  const canPurchase = PURCHASE_ROLES.has(user?.role ?? '');
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
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
    queryKey: ['purchase-orders', page, search, status],
    queryFn: () => purchaseOrdersApi.list({ page, search, status: status || undefined }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Purchase orders</h1>
          <p className="text-sm text-muted-foreground">Stock on order from suppliers, from draft through to received.</p>
        </div>
        {canPurchase && (
          <Button
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            New purchase order
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by PO number or notes"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as PurchaseOrderStatus | '');
            setPage(1);
          }}
          className="max-w-48"
        >
          <option value="">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {PURCHASE_ORDER_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={PURCHASE_ORDER_COLUMNS}
        rows={data?.items ?? []}
        rowKey={(po) => po.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No purchase orders found."
        onRowClick={(po) => {
          router.push(`/dashboard/purchase-orders/${po.id}`);
        }}
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />

      <NewPurchaseOrderDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        onCreated={(id) => {
          router.push(`/dashboard/purchase-orders/${id}`);
        }}
      />
    </div>
  );
}

const PURCHASE_ORDER_COLUMNS: DataTableColumn<PurchaseOrderSummary>[] = [
  { key: 'poNumber', label: 'PO', render: (po) => <span className="font-medium">{po.poNumber}</span> },
  { key: 'supplier', label: 'Supplier', render: (po) => <span className="text-muted-foreground">{po.supplier.name}</span> },
  { key: 'status', label: 'Status', render: (po) => <PurchaseOrderStatusBadge status={po.status} /> },
  { key: 'items', label: 'Items', align: 'right', render: (po) => <span className="tabular-nums">{po._count.items}</span> },
  { key: 'total', label: 'Total', align: 'right', render: (po) => <span className="tabular-nums">{formatCurrency(po.total)}</span> },
  {
    key: 'expected',
    label: 'Expected',
    render: (po) => <span className="text-muted-foreground">{po.expectedDate === null ? '-' : formatDateTime(po.expectedDate)}</span>,
  },
  { key: 'created', label: 'Created', render: (po) => <span className="text-muted-foreground">{formatDateTime(po.createdAt)}</span> },
];

/** A purchase order needs a supplier before it exists, so opening one is pick-then-create. */
function NewPurchaseOrderDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="New purchase order">
      {open && <NewPurchaseOrderForm onClose={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function NewPurchaseOrderForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createMutation = useMutation({ mutationFn: purchaseOrdersApi.create });

  async function handleCreate(): Promise<void> {
    if (supplier === null) return;
    setError(null);
    try {
      const po = await createMutation.mutateAsync({ supplierId: supplier.id });
      onClose();
      onCreated(po.id);
    } catch (submitError) {
      setError(errorMessage(submitError));
    }
  }

  return (
    <div className="space-y-3">
      {supplier === null ? (
        <SupplierPicker
          onSelect={(selected) => {
            setSupplier(selected);
          }}
        />
      ) : (
        <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
          <span className="font-medium">{supplier.name}</span>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setSupplier(null);
            }}
          >
            Change
          </button>
        </div>
      )}

      {error !== null && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={supplier === null || createMutation.isPending} onClick={() => void handleCreate()}>
          {createMutation.isPending ? 'Creating...' : 'Create draft'}
        </Button>
      </div>
    </div>
  );
}
