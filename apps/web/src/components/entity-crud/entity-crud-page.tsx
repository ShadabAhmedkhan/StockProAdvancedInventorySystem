'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import type { Column, EntityApi, EntityBase, FormField } from './types';

interface EntityCrudPageProps<T extends EntityBase> {
  title: string;
  description: string;
  queryKey: string;
  api: EntityApi<T>;
  columns: Column<T>[];
  formFields: FormField[];
  searchPlaceholder: string;
  /** Whether the signed-in user's role may create/edit records. */
  canWrite: boolean;
  /** Whether the signed-in user's role may soft-delete/restore records. */
  canDelete: boolean;
}

function emptyValues(fields: FormField[]): Record<string, string> {
  // A select defaults to its first option, since '' would not be a valid selection for it.
  return Object.fromEntries(fields.map((field) => [field.name, field.type === 'select' ? (field.options?.[0]?.value ?? '') : '']));
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function valuesFromItem(fields: FormField[], item: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.name, toDisplayString(item[field.name])]));
}

export function EntityCrudPage<T extends EntityBase>({
  title,
  description,
  queryKey,
  api,
  columns,
  formFields,
  searchPlaceholder,
  canWrite,
  canDelete,
}: EntityCrudPageProps<T>): React.JSX.Element {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<T | null>(null);
  const [values, setValues] = useState<Record<string, string>>(emptyValues(formFields));
  const [formError, setFormError] = useState<string | null>(null);

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
    queryKey: [queryKey, page, search, includeDeleted],
    queryFn: () => api.list({ page, search, includeDeleted }),
  });

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: [queryKey] });

  const singular = title.replace(/s$/, '');

  const createMutation = useMutation({ mutationFn: (input: Record<string, string>) => api.create(input) });
  const updateMutation = useMutation({ mutationFn: ({ id, input }: { id: string; input: Record<string, string> }) => api.update(id, input) });
  const removeMutation = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => toast.success(`${singular} deleted`),
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });
  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.restore(id),
    onSuccess: () => toast.success(`${singular} restored`),
    onError: (mutationError) => toast.error(errorMessage(mutationError)),
  });

  function openCreate(): void {
    setEditingItem(null);
    setValues(emptyValues(formFields));
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(item: T): void {
    setEditingItem(item);
    setValues(valuesFromItem(formFields, item as Record<string, unknown>));
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    try {
      if (editingItem === null) {
        await createMutation.mutateAsync(values);
        toast.success(`${singular} created`);
      } else {
        await updateMutation.mutateAsync({ id: editingItem.id, input: values });
        toast.success(`${singular} updated`);
      }
      await invalidate();
      setDialogOpen(false);
    } catch (submitError) {
      setFormError(errorMessage(submitError));
    }
  }

  async function handleRemove(id: string): Promise<void> {
    await removeMutation.mutateAsync(id);
    await invalidate();
  }

  async function handleRestore(id: string): Promise<void> {
    await restoreMutation.mutateAsync(id);
    await invalidate();
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {canWrite && <Button onClick={openCreate}>New</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={searchPlaceholder}
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => {
              setIncludeDeleted(event.target.checked);
              setPage(1);
            }}
          />
          Show deleted
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
                    {columns.map((column) => (
                      <th key={column.key} className="p-3 font-medium">
                        {column.label}
                      </th>
                    ))}
                    <th className="p-3 font-medium">Updated</th>
                    <th className="p-3 font-medium">Status</th>
                    {(canWrite || canDelete) && <th className="p-3 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={columns.length + 3} className="p-4 text-center text-muted-foreground">
                        No records found.
                      </td>
                    </tr>
                  )}
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      {columns.map((column) => (
                        <td key={column.key} className={column.className ?? 'p-3'}>
                          {column.render !== undefined ? column.render(item) : toDisplayString((item as Record<string, unknown>)[column.key]) || '-'}
                        </td>
                      ))}
                      <td className="p-3 text-muted-foreground">{formatDateTime(item.updatedAt)}</td>
                      <td className="p-3">
                        {item.deletedAt === null ? (
                          <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">Active</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Deleted</span>
                        )}
                      </td>
                      {(canWrite || canDelete) && (
                        <td className="p-3 text-right">
                          <div className="flex justify-end gap-2">
                            {canWrite && item.deletedAt === null && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  openEdit(item);
                                }}
                              >
                                Edit
                              </Button>
                            )}
                            {canDelete && item.deletedAt === null && (
                              <Button variant="outline" size="sm" onClick={() => void handleRemove(item.id)}>
                                Delete
                              </Button>
                            )}
                            {canDelete && item.deletedAt !== null && (
                              <Button variant="outline" size="sm" onClick={() => void handleRestore(item.id)}>
                                Restore
                              </Button>
                            )}
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

      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        title={editingItem === null ? `New ${singular}` : `Edit ${singular}`}
      >
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="space-y-3"
        >
          {formFields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={field.name}>
                {field.label}
                {field.required === true && ' *'}
              </Label>
              {field.type === 'textarea' ? (
                <Textarea
                  id={field.name}
                  required={field.required}
                  placeholder={field.placeholder}
                  value={values[field.name] ?? ''}
                  onChange={(event) => {
                    setValues((current) => ({ ...current, [field.name]: event.target.value }));
                  }}
                />
              ) : field.type === 'select' ? (
                <Select
                  id={field.name}
                  value={values[field.name] ?? ''}
                  onChange={(event) => {
                    setValues((current) => ({ ...current, [field.name]: event.target.value }));
                  }}
                >
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={field.name}
                  type={field.type ?? 'text'}
                  required={field.required}
                  placeholder={field.placeholder}
                  value={values[field.name] ?? ''}
                  onChange={(event) => {
                    setValues((current) => ({ ...current, [field.name]: event.target.value }));
                  }}
                />
              )}
            </div>
          ))}

          {formError !== null && <p className="text-sm text-danger">{formError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
