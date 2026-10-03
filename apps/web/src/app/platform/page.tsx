'use client';

import { useQuery } from '@tanstack/react-query';
import { Ban, Building2, CircleCheck, Clock, TimerOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { KpiCard } from '@/features/dashboard/components/kpi-card';
import { platformAdminApi } from '@/features/platform-admin/api';
import { OrganizationStatusBadge } from '@/features/platform-admin/components/organization-status-badge';
import { PlatformSignOutButton } from '@/features/platform-admin/components/sign-out-button';
import { DISPLAY_STATUSES, displayStatus, lastSeenLabel, STATUS_LABELS, trialDaysLeft, type OrganizationDisplayStatus } from '@/features/platform-admin/labels';
import type { PlatformOrganizationSummary } from '@/features/platform-admin/types';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatNumber } from '@/lib/format';
import { getPlatformAdminEmail, getPlatformAdminToken } from '@/lib/platform-admin-token';

type StatusFilter = OrganizationDisplayStatus | 'ALL';

function TrialInfo({ organization }: { organization: PlatformOrganizationSummary }): React.JSX.Element | null {
  if (organization.subscriptionStatus !== 'TRIALING' || organization.trialEndsAt === null) {
    return null;
  }
  if (displayStatus(organization) === 'TRIAL_EXPIRED') {
    return <span className="text-sm text-muted-foreground">ended {formatDateTime(organization.trialEndsAt)}</span>;
  }
  const days = trialDaysLeft(organization.trialEndsAt);
  return (
    <span className="text-sm text-muted-foreground">
      {days} day{days === 1 ? '' : 's'} left
    </span>
  );
}

export default function PlatformAdminPage(): React.JSX.Element | null {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

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

  const counts = useMemo(() => {
    const byStatus = new Map<OrganizationDisplayStatus, number>();
    for (const organization of data ?? []) {
      const status = displayStatus(organization);
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    }
    return {
      total: data?.length ?? 0,
      users: (data ?? []).reduce((sum, organization) => sum + organization.userCount, 0),
      of: (status: OrganizationDisplayStatus): number => byStatus.get(status) ?? 0,
    };
  }, [data]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter(
      (organization) =>
        (term === '' || organization.name.toLowerCase().includes(term)) && (statusFilter === 'ALL' || displayStatus(organization) === statusFilter),
    );
  }, [data, search, statusFilter]);

  if (getPlatformAdminToken() === null) {
    return null;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Organizations</h1>
          <p className="text-sm text-muted-foreground">Signed in as {getPlatformAdminEmail()}</p>
        </div>
        <PlatformSignOutButton />
      </div>

      {data !== undefined && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard label="Organizations" value={formatNumber(counts.total)} hint={`${formatNumber(counts.users)} users in total`} icon={Building2} />
          <KpiCard label="Trialing" value={formatNumber(counts.of('TRIALING'))} icon={Clock} />
          <KpiCard label="Trial expired" value={formatNumber(counts.of('TRIAL_EXPIRED'))} icon={TimerOff} tone="warning" />
          <KpiCard label="Active (paid)" value={formatNumber(counts.of('ACTIVE'))} icon={CircleCheck} tone="success" />
          <KpiCard
            label="Suspended"
            value={formatNumber(counts.of('SUSPENDED'))}
            hint={`${formatNumber(counts.of('PAST_DUE') + counts.of('CANCELED'))} past due or canceled`}
            icon={Ban}
            tone="danger"
          />
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search organizations..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          className="sm:max-w-xs"
        />
        <Select
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value as StatusFilter);
          }}
          className="sm:max-w-48"
          aria-label="Filter by status"
        >
          <option value="ALL">All statuses</option>
          {DISPLAY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {isError && <p className="text-sm text-danger">{errorMessage(error)}</p>}
      {data !== undefined && visible.length === 0 && <p className="text-sm text-muted-foreground">No organizations match.</p>}

      <div className="space-y-2">
        {visible.map((organization) => (
          <Link key={organization.id} href={`/platform/organizations/${organization.id}`} className="block">
            <Card className="transition-colors hover:bg-muted/50">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{organization.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {organization.userCount} user{organization.userCount === 1 ? '' : 's'} · created {formatDateTime(organization.createdAt)} ·{' '}
                    {lastSeenLabel(organization.lastLoginAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <TrialInfo organization={organization} />
                  <OrganizationStatusBadge organization={organization} />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
