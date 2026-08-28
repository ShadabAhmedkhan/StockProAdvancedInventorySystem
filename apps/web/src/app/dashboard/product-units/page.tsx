'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { productUnitsApi } from '@/features/products/api';
import { PRODUCT_UNIT_STATUS_CLASSES, PRODUCT_UNIT_STATUS_LABELS } from '@/features/products/labels';
import { ProductPicker } from '@/features/orders/components/product-picker';
import type { Product, ProductUnit, ProductUnitStatus } from '@/features/products/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

const WRITE_ROLES = new Set(['ADMIN', 'MANAGER']);
const STATUSES = Object.keys(PRODUCT_UNIT_STATUS_LABELS) as ProductUnitStatus[];

export default function ProductUnitsPage(): React.JSX.Element {
  const { user } = useAuth();
  const canWrite = WRITE_ROLES.has(user?.role ?? '');
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProductUnitStatus | ''>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['product-units', page, search, status],
    queryFn: () => productUnitsApi.list({ page, search, status: status || undefined }),
  });

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['product-units'] });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: ProductUnitStatus }) => productUnitsApi.updateStatus(id, next),
    onSuccess: () => {
      void invalidate();
    },
    onError: (submitError: unknown) => {
      toast.error(errorMessage(submitError));
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Serial &amp; IMEI units</h1>
        <p className="text-sm text-muted-foreground">Every individually tracked unit for products with serial or IMEI tracking enabled.</p>
      </div>

      <ScanBox />

      {canWrite && <RegisterUnitForm onRegistered={() => void invalidate()} />}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by serial number or IMEI"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ProductUnitStatus | '');
            setPage(1);
          }}
          className="max-w-48"
        >
          <option value="">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {PRODUCT_UNIT_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={unitColumns(canWrite, (id, next) => {
          statusMutation.mutate({ id, next });
        })}
        rows={data?.items ?? []}
        rowKey={(unit) => unit.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No units registered yet."
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />
    </div>
  );
}

function unitColumns(canWrite: boolean, onStatusChange: (id: string, next: ProductUnitStatus) => void): DataTableColumn<ProductUnit>[] {
  return [
    { key: 'serialNumber', label: 'Serial / IMEI', render: (unit) => <span className="font-mono">{unit.serialNumber}</span> },
    { key: 'product', label: 'Product', render: (unit) => `${unit.product.name} (${unit.product.sku})` },
    { key: 'location', label: 'Location', render: (unit) => unit.location.name },
    {
      key: 'status',
      label: 'Status',
      render: (unit) =>
        canWrite ? (
          <Select
            value={unit.status}
            onChange={(event) => {
              onStatusChange(unit.id, event.target.value as ProductUnitStatus);
            }}
            className="h-8 py-0 text-xs"
          >
            {Object.keys(PRODUCT_UNIT_STATUS_LABELS).map((value) => (
              <option key={value} value={value}>
                {PRODUCT_UNIT_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        ) : (
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${PRODUCT_UNIT_STATUS_CLASSES[unit.status]}`}>{PRODUCT_UNIT_STATUS_LABELS[unit.status]}</span>
        ),
    },
    { key: 'createdAt', label: 'Registered', render: (unit) => <span className="text-muted-foreground">{formatDateTime(unit.createdAt)}</span> },
  ];
}

/** Scanner-friendly lookup: paste/scan a code and press Enter (a barcode scanner types the code then sends a keyboard Enter). */
function ScanBox(): React.JSX.Element {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ProductUnit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanMutation = useMutation({ mutationFn: productUnitsApi.scan });

  async function handleScan(): Promise<void> {
    if (code.trim() === '') return;
    setError(null);
    setResult(null);
    try {
      const unit = await scanMutation.mutateAsync(code.trim());
      setResult(unit);
    } catch (submitError) {
      setError(errorMessage(submitError));
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <Label htmlFor="scan-code">Scan serial number or IMEI</Label>
      <div className="mt-1.5 flex gap-2">
        <Input
          id="scan-code"
          autoFocus
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleScan();
            }
          }}
          placeholder="Scan or type a code, then press Enter"
          className="max-w-sm"
        />
        <Button
          type="button"
          onClick={() => {
            void handleScan();
          }}
        >
          Look up
        </Button>
      </div>
      {error !== null && <p className="mt-2 text-sm text-danger">{error}</p>}
      {result !== null && (
        <p className="mt-2 text-sm">
          <span className="font-medium">{result.product.name}</span> ({result.product.sku}) &mdash; {result.location.name} &mdash;{' '}
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${PRODUCT_UNIT_STATUS_CLASSES[result.status]}`}>{PRODUCT_UNIT_STATUS_LABELS[result.status]}</span>
        </p>
      )}
    </div>
  );
}

/** Register a new unit against a tracked product. Refused server-side for a product whose trackingType is NONE. */
function RegisterUnitForm({ onRegistered }: { onRegistered: () => void }): React.JSX.Element {
  const [product, setProduct] = useState<Product | null>(null);
  const [serialNumber, setSerialNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createMutation = useMutation({ mutationFn: productUnitsApi.create });

  async function handleRegister(): Promise<void> {
    if (product === null || serialNumber.trim() === '') return;
    setError(null);
    try {
      await createMutation.mutateAsync({ productId: product.id, serialNumber: serialNumber.trim() });
      toast.success('Unit registered');
      setProduct(null);
      setSerialNumber('');
      onRegistered();
    } catch (submitError) {
      setError(errorMessage(submitError));
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium">Register a unit</p>
      <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-start">
        {product === null ? (
          <ProductPicker onSelect={setProduct} />
        ) : (
          <div className="flex h-9 items-center justify-between rounded-md border border-border px-3 text-sm">
            <span>
              {product.name} ({product.sku})
            </span>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => {
                setProduct(null);
              }}
            >
              Change
            </button>
          </div>
        )}
        <Input
          placeholder="Serial number or IMEI"
          value={serialNumber}
          onChange={(event) => {
            setSerialNumber(event.target.value);
          }}
          className="sm:w-56"
        />
        <Button
          type="button"
          disabled={product === null || serialNumber.trim() === '' || createMutation.isPending}
          onClick={() => {
            void handleRegister();
          }}
        >
          Register
        </Button>
      </div>
      {error !== null && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
