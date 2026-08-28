'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { repairsApi } from '@/features/repairs/api';
import { RepairStatusBadge } from '@/features/repairs/components/repair-status-badge';
import { DEVICE_TYPE_LABELS, REPAIR_STATUS_LABELS } from '@/features/repairs/labels';
import type { DeviceType, RepairStatus } from '@/features/repairs/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
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

      <Card>
        <CardContent className="p-0">
          {isLoading && <TableSkeleton />}
          {isError && <p className="p-4 text-sm text-danger">{errorMessage(error)}</p>}
          {data !== undefined && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Repair #</th>
                    <th className="p-3 font-medium">Customer</th>
                    <th className="p-3 font-medium">Device</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Technician</th>
                    <th className="p-3 text-right font-medium">Est. cost</th>
                    <th className="p-3 font-medium">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-muted-foreground">
                        No repairs found.
                      </td>
                    </tr>
                  )}
                  {data.items.map((repair) => (
                    <tr key={repair.id} className="border-b border-border last:border-0 hover:bg-muted">
                      <td className="p-3">
                        <Link href={`/dashboard/repairs/${repair.id}`} className="font-medium hover:underline">
                          {repair.repairNumber}
                        </Link>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {repair.customer.firstName} {repair.customer.lastName}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {DEVICE_TYPE_LABELS[repair.deviceType]}
                        {repair.brand !== null && ` – ${repair.brand}`}
                      </td>
                      <td className="p-3">
                        <RepairStatusBadge status={repair.status} />
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {repair.technician === null ? 'Unassigned' : `${repair.technician.firstName} ${repair.technician.lastName}`}
                      </td>
                      <td className="p-3 text-right tabular-nums">{repair.estimatedCost === null ? '-' : formatCurrency(repair.estimatedCost)}</td>
                      <td className="p-3 text-muted-foreground">{formatDateTime(repair.receivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data !== undefined && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages} &middot; {data.pagination.total} total
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                setPage((current) => current - 1);
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => {
                setPage((current) => current + 1);
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
