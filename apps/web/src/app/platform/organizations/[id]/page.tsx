'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { platformAdminApi } from '@/features/platform-admin/api';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { getPlatformAdminToken } from '@/lib/platform-admin-token';

export default function PlatformAdminOrganizationPage(): React.JSX.Element | null {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const organizationId = params.id;
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (getPlatformAdminToken() === null) {
      router.replace('/platform/login');
    }
  }, [router]);

  const organizationsQuery = useQuery({
    queryKey: ['platform-admin', 'organizations'],
    queryFn: platformAdminApi.listOrganizations,
    enabled: getPlatformAdminToken() !== null,
  });
  const organization = organizationsQuery.data?.find((candidate) => candidate.id === organizationId);

  const usersQuery = useQuery({
    queryKey: ['platform-admin', 'organizations', organizationId, 'users'],
    queryFn: () => platformAdminApi.listOrganizationUsers(organizationId),
    enabled: getPlatformAdminToken() !== null,
  });

  const suspendMutation = useMutation({
    mutationFn: () => platformAdminApi.suspend(organizationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform-admin', 'organizations'] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: () => platformAdminApi.reactivate(organizationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform-admin', 'organizations'] }),
  });

  async function handleSuspend(): Promise<void> {
    setActionError(null);
    try {
      await suspendMutation.mutateAsync();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function handleReactivate(): Promise<void> {
    setActionError(null);
    try {
      await reactivateMutation.mutateAsync();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  if (getPlatformAdminToken() === null) {
    return null;
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <Link href="/platform" className="text-sm text-muted-foreground underline">
        ← All organizations
      </Link>

      {organization !== undefined && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{organization.name}</h1>
            <p className="text-sm text-muted-foreground">
              <Badge>{organization.subscriptionStatus}</Badge> · created {formatDateTime(organization.createdAt)}
            </p>
          </div>
          <div className="flex gap-2">
            {organization.subscriptionStatus === 'SUSPENDED' ? (
              <Button onClick={() => void handleReactivate()} disabled={reactivateMutation.isPending}>
                {reactivateMutation.isPending ? 'Reactivating...' : 'Reactivate'}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void handleSuspend()} disabled={suspendMutation.isPending}>
                {suspendMutation.isPending ? 'Suspending...' : 'Suspend'}
              </Button>
            )}
          </div>
        </div>
      )}

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-medium text-muted-foreground">Users</h2>
          {usersQuery.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {usersQuery.isError && <p className="text-sm text-danger">{errorMessage(usersQuery.error)}</p>}
          {usersQuery.data?.map((user) => (
            <div key={user.id} className="flex items-center justify-between border-t border-border py-2 first:border-t-0">
              <div>
                <p className="text-sm font-medium">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <p>{user.role}</p>
                <p>{user.status}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
