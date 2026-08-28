'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, DollarSign, Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { stockApi } from '@/features/products/api';
import { StockAdjustDialog } from '@/features/products/components/stock-adjust-dialog';
import { StockStatusBadge } from '@/features/products/components/stock-status-badge';
import type { StockLevel, StockMovement } from '@/features/products/types';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { isInboundMovement, STOCK_MOVEMENT_LABELS } from '@/lib/stock-movement-labels';

const WRITE_ROLES = new Set(['ADMIN', 'MANAGER']);
const STATUS_TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'OK', label: 'In stock' },
  { value: 'LOW', label: 'Low' },
  { value: 'OUT', label: 'Out of stock' },
] as const;

type StatusTab = (typeof STATUS_TABS)[number]['value'];
type PageTab = 'levels' | 'movements';

export default function InventoryPage(): React.JSX.Element {
  const { user } = useAuth();
  const canAdjust = WRITE_ROLES.has(user?.role ?? '');
  const [tab, setTab] = useState<PageTab>('levels');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Inventory</h1>
        <p className="text-sm text-muted-foreground">Stock on hand and the movement ledger behind it.</p>
      </div>

      <SummaryStrip />

      <div className="flex gap-1 border-b border-border">
        <TabButton
          active={tab === 'levels'}
          onClick={() => {
            setTab('levels');
          }}
        >
          Stock levels
        </TabButton>
        <TabButton
          active={tab === 'movements'}
          onClick={() => {
            setTab('movements');
          }}
        >
          Movements
        </TabButton>
      </div>

      {tab === 'levels' && <StockLevelsTab canAdjust={canAdjust} />}
      {tab === 'movements' && <MovementsTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('border-b-2 px-3 py-2 text-sm', active ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
    >
      {children}
    </button>
  );
}

function SummaryStrip(): React.JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['stock-summary'], queryFn: stockApi.summary });

  if (isLoading || data === undefined) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-6 w-16" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <SummaryCard label="Products" value={String(data.totalProducts)} icon={Package} />
      <SummaryCard label="Units on hand" value={String(data.totalUnits)} icon={Boxes} />
      <SummaryCard label="Value at retail" value={formatCurrency(data.inventoryValueAtRetail)} icon={DollarSign} />
      <SummaryCard
        label="Alerts"
        value={String(data.lowStockCount + data.outOfStockCount)}
        hint={`${String(data.outOfStockCount)} out of stock`}
        icon={AlertTriangle}
        tone={data.outOfStockCount > 0 ? 'danger' : 'warning'}
      />
    </div>
  );
}

const TONE_STYLES = {
  default: 'bg-primary/10 text-primary',
  warning: 'bg-warning/20 text-warning',
  danger: 'bg-danger/15 text-danger',
} as const;

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof TONE_STYLES;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', TONE_STYLES[tone])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function stockLevelColumns(canAdjust: boolean, setAdjusting: (level: StockLevel) => void): DataTableColumn<StockLevel>[] {
  return [
    { key: 'sku', label: 'SKU', render: (level) => <span className="font-mono text-xs">{level.sku}</span> },
    { key: 'name', label: 'Name', render: (level) => level.name },
    { key: 'onHand', label: 'On hand', align: 'right', render: (level) => <span className="tabular-nums">{level.quantity}</span> },
    { key: 'reserved', label: 'Reserved', align: 'right', render: (level) => <span className="tabular-nums">{level.reservedQuantity}</span> },
    { key: 'available', label: 'Available', align: 'right', render: (level) => <span className="tabular-nums">{level.availableQuantity}</span> },
    { key: 'reorderAt', label: 'Reorder at', align: 'right', render: (level) => <span className="tabular-nums">{level.minimumStock}</span> },
    { key: 'status', label: 'Status', render: (level) => <StockStatusBadge status={level.stockStatus} /> },
    ...(canAdjust
      ? [
          {
            key: 'actions',
            label: 'Actions',
            align: 'right' as const,
            render: (level: StockLevel) => (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAdjusting(level);
                }}
              >
                Adjust
              </Button>
            ),
          },
        ]
      : []),
  ];
}

function StockLevelsTab({ canAdjust }: { canAdjust: boolean }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('ALL');
  const [adjusting, setAdjusting] = useState<StockLevel | null>(null);

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
    queryKey: ['stock-levels', page, search, statusTab],
    queryFn: () => stockApi.list({ page, search, stockStatus: statusTab }),
  });

  const adjustMutation = useMutation({ mutationFn: stockApi.adjust });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by SKU or name"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
          className="max-w-xs"
        />
        <div className="flex gap-1">
          {STATUS_TABS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={statusTab === option.value ? 'default' : 'outline'}
              onClick={() => {
                setStatusTab(option.value);
                setPage(1);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <DataTable
        columns={stockLevelColumns(canAdjust, setAdjusting)}
        rows={data?.items ?? []}
        rowKey={(level) => level.productId}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No stock records found."
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />

      <StockAdjustDialog
        open={adjusting !== null}
        onClose={() => {
          setAdjusting(null);
        }}
        stockLevel={adjusting}
        onSubmit={async (input) => {
          await adjustMutation.mutateAsync(input);
          await queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
          await queryClient.invalidateQueries({ queryKey: ['stock-summary'] });
        }}
      />
    </div>
  );
}

const MOVEMENT_COLUMNS: DataTableColumn<StockMovement>[] = [
  { key: 'date', label: 'Date', render: (movement) => <span className="text-muted-foreground">{formatDateTime(movement.createdAt)}</span> },
  {
    key: 'product',
    label: 'Product',
    render: (movement) => (
      <>
        {movement.product.name}
        <span className="ml-1 font-mono text-xs text-muted-foreground">{movement.product.sku}</span>
      </>
    ),
  },
  { key: 'type', label: 'Type', render: (movement) => <span className="text-muted-foreground">{STOCK_MOVEMENT_LABELS[movement.type]}</span> },
  {
    key: 'quantity',
    label: 'Quantity',
    align: 'right',
    render: (movement) => (
      <span className={cn('tabular-nums', isInboundMovement(movement.type) ? 'text-success' : 'text-danger')}>
        {isInboundMovement(movement.type) ? '+' : '-'}
        {movement.quantity}
      </span>
    ),
  },
  { key: 'newTotal', label: 'New total', align: 'right', render: (movement) => <span className="tabular-nums">{movement.newQuantity}</span> },
  {
    key: 'by',
    label: 'By',
    render: (movement) => (
      <span className="text-muted-foreground">
        {movement.createdBy.firstName} {movement.createdBy.lastName}
      </span>
    ),
  },
  { key: 'note', label: 'Note', render: (movement) => <span className="text-muted-foreground">{movement.note ?? '-'}</span> },
];

function MovementsTab(): React.JSX.Element {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['stock-movements', page],
    queryFn: () => stockApi.movements({ page }),
  });

  return (
    <DataTable
      columns={MOVEMENT_COLUMNS}
      rows={data?.items ?? []}
      rowKey={(movement) => movement.id}
      isLoading={isLoading}
      isError={isError}
      error={error}
      emptyMessage="No stock movements yet."
      pagination={
        data === undefined
          ? undefined
          : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
      }
    />
  );
}
