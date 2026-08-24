'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { auditApi } from '@/features/audit/api';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@/features/audit/labels';
import type { AuditAction, AuditEntity } from '@/features/audit/types';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

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

      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
          {isError && <p className="p-4 text-sm text-red-600">{errorMessage(error)}</p>}
          {data !== undefined && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">When</th>
                    <th className="p-3 font-medium">Actor</th>
                    <th className="p-3 font-medium">Action</th>
                    <th className="p-3 font-medium">Entity</th>
                    <th className="p-3 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-muted-foreground">
                        No audit entries found.
                      </td>
                    </tr>
                  )}
                  {data.items.map((entry) => (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <td className="p-3 text-muted-foreground">{formatDateTime(entry.createdAt)}</td>
                      <td className="p-3">{entry.user === null ? 'System' : `${entry.user.firstName} ${entry.user.lastName}`}</td>
                      <td className="p-3">{AUDIT_ACTION_LABELS[entry.action]}</td>
                      <td className="p-3 text-muted-foreground">
                        {AUDIT_ENTITY_LABELS[entry.entity]}
                        {entry.entityId !== null && <span className="ml-1 font-mono text-xs">({entry.entityId.slice(0, 8)})</span>}
                      </td>
                      <td className="p-3 text-muted-foreground">{entry.ipAddress ?? '-'}</td>
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
