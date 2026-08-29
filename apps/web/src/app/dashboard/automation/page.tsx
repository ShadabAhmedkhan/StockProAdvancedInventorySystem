'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { automationRulesApi } from '@/features/automation/api';
import { AutomationRuleDialog } from '@/features/automation/components/automation-rule-dialog';
import { NOTIFICATION_TYPE_LABELS } from '@/features/notifications/labels';
import type { AutomationRule } from '@/features/automation/types';
import { errorMessage } from '@/lib/error-message';

export default function AutomationPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['automation-rules', page],
    queryFn: () => automationRulesApi.list(page),
  });

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['automation-rules'] });

  const removeMutation = useMutation({ mutationFn: automationRulesApi.remove });

  async function handleRemove(id: string): Promise<void> {
    setActionError(null);
    try {
      await removeMutation.mutateAsync(id);
      await invalidate();
      toast.success('Automation rule deleted');
    } catch (removeError) {
      setActionError(errorMessage(removeError));
    }
  }

  function openCreate(): void {
    setEditingRule(null);
    setDialogOpen(true);
  }

  function openEdit(rule: AutomationRule): void {
    setEditingRule(rule);
    setDialogOpen(true);
  }

  const columns: DataTableColumn<AutomationRule>[] = [
    {
      key: 'name',
      label: 'Rule',
      render: (rule) => (
        <div>
          <p className="font-medium">{rule.name}</p>
          <p className="text-xs text-muted-foreground">
            WHEN {NOTIFICATION_TYPE_LABELS[rule.triggerType]}
            {rule.conditions.length > 0 && ` IF ${String(rule.conditions.length)} condition(s)`} THEN notify {rule.actionRoles.join(', ')}
          </p>
        </div>
      ),
    },
    { key: 'status', label: 'Status', render: (rule) => <Badge className={rule.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}>{rule.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (rule) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              openEdit(rule);
            }}
          >
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleRemove(rule.id)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Automation rules</h1>
          <p className="text-sm text-muted-foreground">WHEN an event happens, IF conditions match, THEN notify the roles you choose.</p>
        </div>
        <Button onClick={openCreate}>New rule</Button>
      </div>

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(rule) => rule.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No automation rules yet."
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />

      <AutomationRuleDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        rule={editingRule}
        onSubmit={async (input) => {
          if (editingRule === null) {
            await automationRulesApi.create(input);
          } else {
            await automationRulesApi.update(editingRule.id, input);
          }
          await invalidate();
        }}
      />
    </div>
  );
}
