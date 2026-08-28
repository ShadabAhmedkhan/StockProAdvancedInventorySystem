'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { repairsApi } from '@/features/repairs/api';
import { RepairStatusBadge } from '@/features/repairs/components/repair-status-badge';
import { DEVICE_TYPE_LABELS, REPAIR_STATUS_LABELS } from '@/features/repairs/labels';
import type { DeviceType, RepairStatus, RepairSummary } from '@/features/repairs/types';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency, formatDateTime } from '@/lib/format';

const INTAKE_ROLES = new Set(['ADMIN', 'MANAGER', 'STAFF']);
const REPAIR_STATUSES = Object.keys(REPAIR_STATUS_LABELS) as RepairStatus[];
const DEVICE_TYPES = Object.keys(DEVICE_TYPE_LABELS) as DeviceType[];

export default function RepairsPage(): React.JSX.Element {
  const { user } = useAuth();
  const canIntake = INTAKE_ROLES.has(user?.role ?? '');
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<RepairStatus | ''>('');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [openOnly, setOpenOnly] = useState(false);
  const [overdue, setOverdue] = useState(false);

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
    queryKey: ['repairs', page, search, status, deviceType, openOnly, overdue],
    queryFn: () => repairsApi.list({ page, search, status: status || undefined, deviceType: deviceType || undefined, openOnly, overdue }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Repairs</h1>
          <p className="text-sm text-muted-foreground">Devices on the bench, from intake to delivery.</p>
        </div>
        {canIntake && (
          <Button
            onClick={() => {
              router.push('/dashboard/repairs/new');
            }}
          >
            Intake device
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by repair #, serial, IMEI or device"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as RepairStatus | '');
            setPage(1);
          }}
          className="max-w-40"
        >
          <option value="">All statuses</option>
          {REPAIR_STATUSES.map((value) => (
            <option key={value} value={value}>
              {REPAIR_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select
          value={deviceType}
          onChange={(event) => {
            setDeviceType(event.target.value as DeviceType | '');
            setPage(1);
          }}
          className="max-w-40"
        >
          <option value="">All devices</option>
          {DEVICE_TYPES.map((value) => (
            <option key={value} value={value}>
              {DEVICE_TYPE_LABELS[value]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(event) => {
              setOpenOnly(event.target.checked);
              setPage(1);
            }}
          />
          Open only
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(event) => {
              setOverdue(event.target.checked);
              setPage(1);
            }}
          />
          Overdue
        </label>
      </div>

      <DataTable
        columns={REPAIR_COLUMNS}
        rows={data?.items ?? []}
        rowKey={(repair) => repair.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No repairs found."
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />
    </div>
  );
}

const REPAIR_COLUMNS: DataTableColumn<RepairSummary>[] = [
  {
    key: 'repairNumber',
    label: 'Repair #',
    render: (repair) => (
      <Link href={`/dashboard/repairs/${repair.id}`} className="font-medium hover:underline">
        {repair.repairNumber}
      </Link>
    ),
  },
  {
    key: 'customer',
    label: 'Customer',
    render: (repair) => (
      <span className="text-muted-foreground">
        {repair.customer.firstName} {repair.customer.lastName}
      </span>
    ),
  },
  {
    key: 'device',
    label: 'Device',
    render: (repair) => (
      <span className="text-muted-foreground">
        {DEVICE_TYPE_LABELS[repair.deviceType]}
        {repair.brand !== null && ` – ${repair.brand}`}
      </span>
    ),
  },
  { key: 'status', label: 'Status', render: (repair) => <RepairStatusBadge status={repair.status} /> },
  {
    key: 'technician',
    label: 'Technician',
    render: (repair) => (
      <span className="text-muted-foreground">
        {repair.technician === null ? 'Unassigned' : `${repair.technician.firstName} ${repair.technician.lastName}`}
      </span>
    ),
  },
  {
    key: 'estimatedCost',
    label: 'Est. cost',
    align: 'right',
    render: (repair) => <span className="tabular-nums">{repair.estimatedCost === null ? '-' : formatCurrency(repair.estimatedCost)}</span>,
  },
  { key: 'received', label: 'Received', render: (repair) => <span className="text-muted-foreground">{formatDateTime(repair.receivedAt)}</span> },
];
