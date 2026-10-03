'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { platformAdminApi } from '@/features/platform-admin/api';
import { ExtendTrialDialog } from '@/features/platform-admin/components/extend-trial-dialog';
import { OrganizationStatusBadge } from '@/features/platform-admin/components/organization-status-badge';
import { PlatformSignOutButton } from '@/features/platform-admin/components/sign-out-button';
import { activityLabel, lastSeenLabel, trialDaysLeft } from '@/features/platform-admin/labels';
import type { PlatformOrganizationSummary } from '@/features/platform-admin/types';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { getPlatformAdminToken } from '@/lib/platform-admin-token';

function trialSummary(organization: PlatformOrganizationSummary): string {
  if (organization.trialEndsAt === null) {
    return 'No trial date';
  }
  if (new Date(organization.trialEndsAt).getTime() <= Date.now()) {
    return `Ended ${formatDateTime(organization.trialEndsAt)}`;
  }
  const days = trialDaysLeft(organization.trialEndsAt);
  return `${formatDateTime(organization.trialEndsAt)} (${String(days)} day${days === 1 ? '' : 's'} left)`;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

export default function PlatformAdminOrganizationPage(): React.JSX.Element | null {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const organizationId = params.id;
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [isExtendOpen, setIsExtendOpen] = useState(false);

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

  const activityQuery = useQuery({
    queryKey: ['platform-admin', 'organizations', organizationId, 'activity'],
    queryFn: () => platformAdminApi.listOrganizationActivity(organizationId),
    enabled: getPlatformAdminToken() !== null,
  });

  // Every key above starts with this prefix, so one invalidation refreshes the list, users and activity together.
  const invalidateOrganizations = (): void => void queryClient.invalidateQueries({ queryKey: ['platform-admin', 'organizations'] });

  const suspendMutation = useMutation({
    mutationFn: () => platformAdminApi.suspend(organizationId),
    onSuccess: invalidateOrganizations,
  });

  const reactivateMutation = useMutation({
    mutationFn: () => platformAdminApi.reactivate(organizationId),
    onSuccess: invalidateOrganizations,
  });

  const extendTrialMutation = useMutation({
    mutationFn: (days: number) => platformAdminApi.extendTrial(organizationId, days),
    onSuccess: invalidateOrganizations,
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

  const isPaying = organization?.subscriptionStatus === 'ACTIVE';

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <Link href="/platform" className="text-sm text-muted-foreground underline">
          ← All organizations
        </Link>
        <PlatformSignOutButton />
      </div>

      {organizationsQuery.isError && <p className="text-sm text-danger">{errorMessage(organizationsQuery.error)}</p>}
      {organizationsQuery.isSuccess && organization === undefined && <p className="text-sm text-muted-foreground">Organization not found.</p>}

      {organization !== undefined && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">{organization.name}</h1>
              <p className="text-sm text-muted-foreground">
                <OrganizationStatusBadge organization={organization} /> · created {formatDateTime(organization.createdAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setActionError(null);
                  setIsExtendOpen(true);
                }}
                disabled={isPaying}
                title={isPaying ? 'This organization is on a paid subscription - there is no trial to extend' : undefined}
              >
                <CalendarPlus className="h-4 w-4" />
                Extend trial
              </Button>
              {organization.subscriptionStatus === 'SUSPENDED' ? (
                <Button variant="outline" onClick={() => void handleReactivate()} disabled={reactivateMutation.isPending}>
                  {reactivateMutation.isPending ? 'Reactivating...' : 'Reactivate'}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => void handleSuspend()} disabled={suspendMutation.isPending}>
                  {suspendMutation.isPending ? 'Suspending...' : 'Suspend'}
                </Button>
              )}
            </div>
          </div>

          <Card>
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Status" value={<OrganizationStatusBadge organization={organization} />} />
              <Fact label="Trial ends" value={trialSummary(organization)} />
              <Fact label="Users" value={organization.userCount} />
              <Fact label="Last activity" value={lastSeenLabel(organization.lastLoginAt)} />
            </CardContent>
          </Card>

          <ExtendTrialDialog
            open={isExtendOpen}
            onClose={() => {
              setIsExtendOpen(false);
            }}
            organization={organization}
            onSubmit={(days) => extendTrialMutation.mutateAsync(days)}
          />
        </>
      )}

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-medium text-muted-foreground">Users</h2>
          {usersQuery.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {usersQuery.isError && <p className="text-sm text-danger">{errorMessage(usersQuery.error)}</p>}
          {usersQuery.data?.map((user) => (
            <div key={user.id} className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-t-0">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {user.firstName} {user.lastName}
                </p>
                <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              </div>
              <div className="shrink-0 text-right text-sm text-muted-foreground">
                <p>
                  {user.role} · {user.status}
                </p>
                <p className="text-xs">Last login {formatDateTime(user.lastLoginAt)}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-medium text-muted-foreground">Platform activity</h2>
          {activityQuery.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {activityQuery.isError && <p className="text-sm text-danger">{errorMessage(activityQuery.error)}</p>}
          {activityQuery.data?.length === 0 && <p className="text-sm text-muted-foreground">No platform actions yet.</p>}
          {activityQuery.data?.map((activity) => (
            <div key={activity.id} className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-t-0">
              <p className="text-sm">{activityLabel(activity)}</p>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                <p>{formatDateTime(activity.createdAt)}</p>
                {typeof activity.metadata?.actor === 'string' && <p>by {activity.metadata.actor}</p>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
