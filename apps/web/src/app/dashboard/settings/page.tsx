'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { settingsApi, type UpsertSettingInput } from '@/features/settings/api';
import { SettingFormDialog } from '@/features/settings/components/setting-form-dialog';
import type { Setting } from '@/features/settings/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

const WRITE_ROLES = new Set(['ADMIN']);

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

      {actionError !== null && <p className="text-sm text-red-600">{actionError}</p>}

      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
          {isError && <p className="p-4 text-sm text-red-600">{errorMessage(error)}</p>}
          {data !== undefined && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Key</th>
                    <th className="p-3 font-medium">Value</th>
                    <th className="p-3 font-medium">Type</th>
                    <th className="p-3 font-medium">Description</th>
                    <th className="p-3 font-medium">Updated</th>
                    {canWrite && <th className="p-3 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.length === 0 && (
                    <tr>
                      <td colSpan={canWrite ? 6 : 5} className="p-4 text-center text-muted-foreground">
                        No settings configured.
                      </td>
                    </tr>
                  )}
                  {data.map((setting) => (
                    <tr key={setting.id} className="border-b border-border last:border-0">
                      <td className="p-3 font-mono text-xs">{setting.key}</td>
                      <td className="p-3 text-muted-foreground">{setting.value}</td>
                      <td className="p-3 text-muted-foreground">{setting.valueType}</td>
                      <td className="p-3 text-muted-foreground">{setting.description ?? '-'}</td>
                      <td className="p-3 text-muted-foreground">{formatDateTime(setting.updatedAt)}</td>
                      {canWrite && (
                        <td className="p-3 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingSetting(setting);
                                setDialogOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                void handleRemove(setting.key);
                              }}
                              disabled={removeMutation.isPending}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

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
