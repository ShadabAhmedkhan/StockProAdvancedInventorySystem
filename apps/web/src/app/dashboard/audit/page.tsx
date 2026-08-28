'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Select } from '@/components/ui/select';
import { auditApi } from '@/features/audit/api';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@/features/audit/labels';
import type { AuditAction, AuditEntity, AuditLog } from '@/features/audit/types';
import { formatDateTime } from '@/lib/format';

const AUDIT_COLUMNS: DataTableColumn<AuditLog>[] = [
  { key: 'when', label: 'When', render: (entry) => <span className="text-muted-foreground">{formatDateTime(entry.createdAt)}</span> },
  { key: 'actor', label: 'Actor', render: (entry) => (entry.user === null ? 'System' : `${entry.user.firstName} ${entry.user.lastName}`) },
  { key: 'action', label: 'Action', render: (entry) => AUDIT_ACTION_LABELS[entry.action] },
  {
    key: 'entity',
    label: 'Entity',
    render: (entry) => (
      <span className="text-muted-foreground">
        {AUDIT_ENTITY_LABELS[entry.entity]}
        {entry.entityId !== null && <span className="ml-1 font-mono text-xs">({entry.entityId.slice(0, 8)})</span>}
      </span>
    ),
  },
  { key: 'ip', label: 'IP', render: (entry) => <span className="text-muted-foreground">{entry.ipAddress ?? '-'}</span> },
];

const ACTIONS = Object.keys(AUDIT_ACTION_LABELS) as AuditAction[];
const ENTITIES = Object.keys(AUDIT_ENTITY_LABELS) as AuditEntity[];

export default function AuditPage(): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<AuditAction | ''>('');
  const [entity, setEntity] = useState<AuditEntity | ''>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['audit', page, action, entity],
    queryFn: () => auditApi.list({ page, action: action || undefined, entity: entity || undefined }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">The security and money trail: who did what, and when.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={action}
          onChange={(event) => {
            setAction(event.target.value as AuditAction | '');
            setPage(1);
          }}
          className="max-w-48"
        >
          <option value="">All actions</option>
          {ACTIONS.map((value) => (
            <option key={value} value={value}>
              {AUDIT_ACTION_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select
          value={entity}
          onChange={(event) => {
            setEntity(event.target.value as AuditEntity | '');
            setPage(1);
          }}
          className="max-w-40"
        >
          <option value="">All entities</option>
          {ENTITIES.map((value) => (
            <option key={value} value={value}>
              {AUDIT_ENTITY_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={AUDIT_COLUMNS}
        rows={data?.items ?? []}
        rowKey={(entry) => entry.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No audit entries found."
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />
    </div>
  );
}
