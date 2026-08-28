'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { billingApi } from '@/features/billing/api';
import type { SubscriptionStatus } from '@/features/billing/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

const ADMIN_ROLES = new Set(['ADMIN']);

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: 'Free trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment past due',
  CANCELED: 'Canceled',
};

/** Whole days remaining, floored - "0 days left" still reads as urgent rather than as already expired. */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export default function BillingPage(): React.JSX.Element {
  return (
    <Suspense>
      <BillingContent />
    </Suspense>
  );
}

function BillingContent(): React.JSX.Element {
  const { user } = useAuth();
  const isAdmin = ADMIN_ROLES.has(user?.role ?? '');
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get('checkout');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({ queryKey: ['billing', 'status'], queryFn: billingApi.status });

  const checkoutMutation = useMutation({
    mutationFn: billingApi.createCheckoutSession,
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
  });

  const portalMutation = useMutation({
    mutationFn: billingApi.createPortalSession,
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
  });

  async function handleSubscribe(): Promise<void> {
    setActionError(null);
    try {
      await checkoutMutation.mutateAsync();
    } catch (mutateError) {
      setActionError(errorMessage(mutateError));
    }
  }

  async function handleManage(): Promise<void> {
    setActionError(null);
    try {
      await portalMutation.mutateAsync();
    } catch (mutateError) {
      setActionError(errorMessage(mutateError));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">Your organization&apos;s subscription.</p>
      </div>

      {checkoutResult === 'cancelled' && <p className="text-sm text-muted-foreground">Checkout was cancelled - nothing was charged.</p>}
      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <Card>
        <CardContent className="space-y-4 p-4">
          {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {isError && <p className="text-sm text-danger">{errorMessage(error)}</p>}

          {data !== undefined && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="text-lg font-medium">{STATUS_LABEL[data.subscriptionStatus]}</p>
                </div>
                {data.subscriptionStatus === 'TRIALING' && data.trialEndsAt !== null && (
                  <p className="text-sm text-muted-foreground">
                    {daysUntil(data.trialEndsAt)} day{daysUntil(data.trialEndsAt) === 1 ? '' : 's'} left · ends {formatDateTime(data.trialEndsAt)}
                  </p>
                )}
              </div>

              {(data.subscriptionStatus === 'PAST_DUE' || data.subscriptionStatus === 'CANCELED') && (
                <p className="text-sm text-danger">
                  {data.subscriptionStatus === 'PAST_DUE' ? 'Your last payment failed - update your payment method to keep access.' : 'Your subscription has ended.'}
                </p>
              )}

              {isAdmin ? (
                <div className="flex gap-2">
                  {data.subscriptionStatus !== 'ACTIVE' && (
                    <Button onClick={() => void handleSubscribe()} disabled={checkoutMutation.isPending}>
                      {checkoutMutation.isPending ? 'Redirecting...' : 'Subscribe'}
                    </Button>
                  )}
                  {data.canManageBilling && (
                    <Button variant="outline" onClick={() => void handleManage()} disabled={portalMutation.isPending}>
                      {portalMutation.isPending ? 'Redirecting...' : 'Manage billing'}
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Only an administrator can manage billing.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
