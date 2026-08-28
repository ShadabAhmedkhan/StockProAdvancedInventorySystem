'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { platformAdminApi } from '@/features/platform-admin/api';
import type { OrganizationSubscriptionStatus } from '@/features/platform-admin/types';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { getPlatformAdminEmail, getPlatformAdminToken } from '@/lib/platform-admin-token';

const STATUS_BADGE: Record<OrganizationSubscriptionStatus, string> = {
  TRIALING: 'bg-blue-100 text-blue-800',
  ACTIVE: 'bg-green-100 text-green-800',
  PAST_DUE: 'bg-amber-100 text-amber-800',
  CANCELED: 'bg-neutral-100 text-neutral-800',
  SUSPENDED: 'bg-red-100 text-red-800',
};

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export default function PlatformAdminPage(): React.JSX.Element | null {
  const router = useRouter();

  useEffect(() => {
    if (getPlatformAdminToken() === null) {
      router.replace('/platform/login');
    }
  }, [router]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['platform-admin', 'organizations'],
    queryFn: platformAdminApi.listOrganizations,
    enabled: getPlatformAdminToken() !== null,
  });

  if (getPlatformAdminToken() === null) {
    return null;
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Organizations</h1>
          <p className="text-sm text-muted-foreground">Signed in as {getPlatformAdminEmail()}</p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {isError && <p className="text-sm text-danger">{errorMessage(error)}</p>}

      <div className="space-y-2">
        {data?.map((organization) => (
          <Link key={organization.id} href={`/platform/organizations/${organization.id}`}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{organization.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {organization.userCount} user{organization.userCount === 1 ? '' : 's'} · created {formatDateTime(organization.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {organization.subscriptionStatus === 'TRIALING' && organization.trialEndsAt !== null && (
                    <span className="text-sm text-muted-foreground">{daysUntil(organization.trialEndsAt)}d left</span>
                  )}
                  <Badge className={STATUS_BADGE[organization.subscriptionStatus]}>{organization.subscriptionStatus}</Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
