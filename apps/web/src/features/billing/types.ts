export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export interface BillingStatus {
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  canManageBilling: boolean;
}
