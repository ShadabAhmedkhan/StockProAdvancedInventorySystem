'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { usersApi, type CreateUserInput, type UpdateUserInput } from '@/features/users/api';
import { UserFormDialog } from '@/features/users/components/user-form-dialog';
import { USER_ROLE_LABELS, USER_STATUS_CLASSES, USER_STATUS_LABELS } from '@/features/users/labels';
import type { AppUser, UserRole, UserStatus } from '@/features/users/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

const ROLES = Object.keys(USER_ROLE_LABELS) as UserRole[];
const STATUSES = Object.keys(USER_STATUS_LABELS) as UserStatus[];

export default function UsersPage(): React.JSX.Element {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
    queryKey: ['users', page, search, role, status],
    queryFn: () => usersApi.list({ page, search, role: role || undefined, status: status || undefined }),
  });

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['users'] });

  const changeRoleMutation = useMutation({
    mutationFn: ({ id, newRole }: { id: string; newRole: UserRole }) => usersApi.changeRole(id, newRole),
    onSuccess: invalidate,
  });
  const changeStatusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: UserStatus }) => usersApi.changeStatus(id, newStatus),
    onSuccess: invalidate,
  });

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await action();
    } catch (actionErr) {
      setActionError(errorMessage(actionErr));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">Everyone with an account, their role and access.</p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setEditingUser(null);
              setDialogOpen(true);
            }}
          >
            Create user
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by name or email"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
          className="max-w-xs"
        />
        <Select
          value={role}
          onChange={(event) => {
            setRole(event.target.value as UserRole | '');
            setPage(1);
          }}
          className="max-w-40"
        >
          <option value="">All roles</option>
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {USER_ROLE_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as UserStatus | '');
            setPage(1);
          }}
          className="max-w-40"
        >
          <option value="">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {USER_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <Card>
        <CardContent className="p-0">
          {isLoading && <TableSkeleton />}
          {isError && <p className="p-4 text-sm text-danger">{errorMessage(error)}</p>}
          {data !== undefined && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Email</th>
                    <th className="p-3 font-medium">Role</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Last login</th>
                    {isAdmin && <th className="p-3 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={isAdmin ? 6 : 5} className="p-4 text-center text-muted-foreground">
                        No users found.
                      </td>
                    </tr>
                  )}
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="p-3">
                        {item.firstName} {item.lastName}
                        {item.id === user?.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </td>
                      <td className="p-3 text-muted-foreground">{item.email}</td>
                      <td className="p-3">
                        {isAdmin ? (
                          <Select
                            value={item.role}
                            onChange={(event) => {
                              void runAction(() => changeRoleMutation.mutateAsync({ id: item.id, newRole: event.target.value as UserRole }));
                            }}
                            className="h-8 text-xs"
                          >
                            {ROLES.map((value) => (
                              <option key={value} value={value}>
                                {USER_ROLE_LABELS[value]}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          USER_ROLE_LABELS[item.role]
                        )}
                      </td>
                      <td className="p-3">
                        {isAdmin ? (
                          <Select
                            value={item.status}
                            onChange={(event) => {
                              void runAction(() => changeStatusMutation.mutateAsync({ id: item.id, newStatus: event.target.value as UserStatus }));
                            }}
                            className="h-8 text-xs"
                          >
                            {STATUSES.map((value) => (
                              <option key={value} value={value}>
                                {USER_STATUS_LABELS[value]}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Badge className={USER_STATUS_CLASSES[item.status]}>{USER_STATUS_LABELS[item.status]}</Badge>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">{formatDateTime(item.lastLoginAt)}</td>
                      {isAdmin && (
                        <td className="p-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingUser(item);
                              setDialogOpen(true);
                            }}
                          >
                            Edit
                          </Button>
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

      <UserFormDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        editingUser={editingUser}
        onCreate={async (input: CreateUserInput) => {
          await usersApi.create(input);
          await invalidate();
        }}
        onUpdate={async (id: string, input: UpdateUserInput) => {
          await usersApi.update(id, input);
          await invalidate();
        }}
      />
    </div>
  );
}
