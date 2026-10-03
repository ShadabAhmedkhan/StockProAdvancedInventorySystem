export type OrganizationSubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'SUSPENDED';

export interface PlatformOrganizationSummary {
  id: string;
  name: string;
  subscriptionStatus: OrganizationSubscriptionStatus;
  trialEndsAt: string | null;
  createdAt: string;
  userCount: number;
  lastLoginAt: string | null;
}

export interface PlatformOrganizationUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
}

export interface PlatformOrganizationActivity {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface PlatformAdminSession {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  admin: { id: string; email: string };
}
