'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { settingsApi, type UpsertSettingInput } from '@/features/settings/api';
import { SettingFormDialog } from '@/features/settings/components/setting-form-dialog';
import type { Setting } from '@/features/settings/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

const WRITE_ROLES = new Set(['ADMIN']);

function settingColumns(
  canWrite: boolean,
  deleting: boolean,
  onDelete: (setting: Setting) => void,
  onEdit: (setting: Setting) => void,
): DataTableColumn<Setting>[] {
  return [
    { key: 'key', label: 'Key', render: (setting) => <span className="font-mono text-xs">{setting.key}</span> },
    { key: 'value', label: 'Value', render: (setting) => <span className="text-muted-foreground">{setting.value}</span> },
    { key: 'type', label: 'Type', render: (setting) => <span className="text-muted-foreground">{setting.valueType}</span> },
    { key: 'description', label: 'Description', render: (setting) => <span className="text-muted-foreground">{setting.description ?? '-'}</span> },
    { key: 'updated', label: 'Updated', render: (setting) => <span className="text-muted-foreground">{formatDateTime(setting.updatedAt)}</span> },
    ...(canWrite
      ? [
          {
            key: 'actions',
            label: 'Actions',
            align: 'right' as const,
            render: (setting: Setting) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onEdit(setting);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onDelete(setting);
                  }}
                  disabled={deleting}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];
}

export default function SettingsPage(): React.JSX.Element {
  const { user } = useAuth();
  const canWrite = WRITE_ROLES.has(user?.role ?? '');
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSetting, setEditingSetting] = useState<Setting | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.list });

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['settings'] });
  const removeMutation = useMutation({ mutationFn: (key: string) => settingsApi.remove(key), onSuccess: invalidate });

  async function handleRemove(key: string): Promise<void> {
    setActionError(null);
    try {
      await removeMutation.mutateAsync(key);
    } catch (removeError) {
      setActionError(errorMessage(removeError));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">System-wide configuration values.</p>
        </div>
        {canWrite && (
          <Button
            onClick={() => {
              setEditingSetting(null);
              setDialogOpen(true);
            }}
          >
            New setting
          </Button>
        )}
      </div>

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <DataTable
        columns={settingColumns(canWrite, removeMutation.isPending, (setting) => {
          void handleRemove(setting.key);
        }, (setting) => {
          setEditingSetting(setting);
          setDialogOpen(true);
        })}
        rows={data ?? []}
        rowKey={(setting) => setting.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No settings configured."
      />

      <SettingFormDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        editingSetting={editingSetting}
        onSubmit={async (key: string, input: UpsertSettingInput) => {
          await settingsApi.upsert(key, input);
          await invalidate();
        }}
      />
    </div>
  );
}
