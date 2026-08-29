import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { AppConfiguration } from '../config/app.config';
import type { StripeConfiguration } from '../config/stripe.config';
import { SubscriptionStatus } from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

const checkoutSessionsCreate = jest.fn<Promise<{ url: string | null }>, [Record<string, unknown>]>();
const portalSessionsCreate = jest.fn();
const webhooksConstructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: checkoutSessionsCreate } },
    billingPortal: { sessions: { create: portalSessionsCreate } },
    webhooks: { constructEvent: webhooksConstructEvent },
  }));
});

const BASE_URL = 'https://app.stockpro.test';

function service(overrides: { secretKey?: string; webhookSecret?: string; priceId?: string } = {}): {
  service: BillingService;
  organizationFindUniqueOrThrow: jest.Mock;
  organizationFindUnique: jest.Mock;
  organizationUpdate: jest.Mock;
} {
  const organizationFindUniqueOrThrow = jest.fn();
  const organizationFindUnique = jest.fn();
  const organizationUpdate = jest.fn();

  const prisma = {
    organization: { findUniqueOrThrow: organizationFindUniqueOrThrow, findUnique: organizationFindUnique, update: organizationUpdate },
    // A payment failure fans out a SUBSCRIPTION_PAYMENT_FAILED notification to the org's admins.
    user: { findMany: jest.fn(() => Promise.resolve([])) },
    notification: { createMany: jest.fn(() => Promise.resolve({ count: 0 })) },
  } as unknown as PrismaService;

  const config: StripeConfiguration = { secretKey: 'sk_test_123', webhookSecret: 'whsec_123', priceId: 'price_123', ...overrides };
  const app = { corsOrigins: [BASE_URL] } as AppConfiguration;

  return {
    service: new BillingService(config, app, prisma),
    organizationFindUniqueOrThrow,
    organizationFindUnique,
    organizationUpdate,
  };
}

describe('BillingService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('status', () => {
    it('reports whether the org has a Stripe customer without exposing the id', async () => {
      const { service: billing, organizationFindUniqueOrThrow } = service();
      const trialEndsAt = new Date('2026-09-01T00:00:00.000Z');
      organizationFindUniqueOrThrow.mockResolvedValue({ subscriptionStatus: SubscriptionStatus.TRIALING, trialEndsAt, stripeCustomerId: null });

      const result = await billing.status('org-1');

      expect(result).toEqual({ subscriptionStatus: SubscriptionStatus.TRIALING, trialEndsAt, canManageBilling: false });
    });

    it('reports canManageBilling once a Stripe customer exists', async () => {
      const { service: billing, organizationFindUniqueOrThrow } = service();
      organizationFindUniqueOrThrow.mockResolvedValue({ subscriptionStatus: SubscriptionStatus.ACTIVE, trialEndsAt: null, stripeCustomerId: 'cus_1' });

      const result = await billing.status('org-1');

      expect(result.canManageBilling).toBe(true);
    });
  });

  describe('when billing is not configured', () => {
    it('refuses to create a checkout session', async () => {
      const { service: unconfigured } = service({ secretKey: undefined });
      await expect(unconfigured.createCheckoutSession('org-1', 'a@b.test')).rejects.toThrow(ServiceUnavailableException);
    });

    it('refuses to handle a webhook', async () => {
      const { service: unconfigured } = service({ secretKey: undefined });
      await expect(unconfigured.handleWebhook(Buffer.from('{}'), 'sig')).rejects.toThrow(ServiceUnavailableException);
    });

    it('refuses a checkout session with no price configured', async () => {
      const { service: unconfigured } = service({ priceId: undefined });
      await expect(unconfigured.createCheckoutSession('org-1', 'a@b.test')).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('createCheckoutSession', () => {
    it('starts a subscription checkout against the configured price', async () => {
      const { service: billing, organizationFindUniqueOrThrow } = service();
      organizationFindUniqueOrThrow.mockResolvedValue({ stripeCustomerId: null });
      checkoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/session' });

      const result = await billing.createCheckoutSession('org-1', 'admin@org1.test');

      expect(result).toEqual({ url: 'https://checkout.stripe.test/session' });
      const call = checkoutSessionsCreate.mock.calls[0]?.[0];
      if (call === undefined) {
        throw new Error('expected checkoutSessionsCreate to have been called');
      }
      expect(call.mode).toBe('subscription');
      expect(call.customer_email).toBe('admin@org1.test');
      expect(call.metadata).toEqual({ organizationId: 'org-1' });
    });

    it('reuses the existing Stripe customer instead of a fresh email', async () => {
      const { service: billing, organizationFindUniqueOrThrow } = service();
      organizationFindUniqueOrThrow.mockResolvedValue({ stripeCustomerId: 'cus_existing' });
      checkoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/session' });

      await billing.createCheckoutSession('org-1', 'admin@org1.test');

      const call = checkoutSessionsCreate.mock.calls[0]?.[0];
      if (call === undefined) {
        throw new Error('expected checkoutSessionsCreate to have been called');
      }
      expect(call.customer).toBe('cus_existing');
      expect(call.customer_email).toBeUndefined();
    });
  });

  describe('createPortalSession', () => {
    it('refuses an organization with no billing history', async () => {
      const { service: billing, organizationFindUniqueOrThrow } = service();
      organizationFindUniqueOrThrow.mockResolvedValue({ stripeCustomerId: null });

      await expect(billing.createPortalSession('org-1')).rejects.toThrow(BadRequestException);
    });

    it('opens a portal session for the organization Stripe customer', async () => {
      const { service: billing, organizationFindUniqueOrThrow } = service();
      organizationFindUniqueOrThrow.mockResolvedValue({ stripeCustomerId: 'cus_existing' });
      portalSessionsCreate.mockResolvedValue({ url: 'https://billing.stripe.test/portal' });

      const result = await billing.createPortalSession('org-1');

      expect(result).toEqual({ url: 'https://billing.stripe.test/portal' });
      expect(portalSessionsCreate).toHaveBeenCalledWith({ customer: 'cus_existing', return_url: `${BASE_URL}/dashboard/billing` });
    });
  });

  describe('handleWebhook', () => {
    it('rejects a bad signature rather than trusting the payload', async () => {
      const { service: billing } = service();
      webhooksConstructEvent.mockImplementation(() => {
        throw new Error('signature mismatch');
      });

      await expect(billing.handleWebhook(Buffer.from('{}'), 'bad-signature')).rejects.toThrow(BadRequestException);
    });

    it('activates the organization on checkout.session.completed', async () => {
      const { service: billing, organizationUpdate } = service();
      webhooksConstructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_1', customer: 'cus_new', subscription: 'sub_new', metadata: { organizationId: 'org-1' } } },
      });

      await billing.handleWebhook(Buffer.from('{}'), 'sig');

      expect(organizationUpdate).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { stripeCustomerId: 'cus_new', stripeSubscriptionId: 'sub_new', subscriptionStatus: SubscriptionStatus.ACTIVE },
      });
    });

    it('ignores a checkout.session.completed with no organizationId rather than throwing', async () => {
      const { service: billing, organizationUpdate } = service();
      webhooksConstructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_1', customer: 'cus_new', subscription: 'sub_new', metadata: {} } },
      });

      await billing.handleWebhook(Buffer.from('{}'), 'sig');

      expect(organizationUpdate).not.toHaveBeenCalled();
    });

    it('carries a subscription status update by Stripe customer id', async () => {
      const { service: billing, organizationFindUnique, organizationUpdate } = service();
      organizationFindUnique.mockResolvedValue({ id: 'org-1' });
      webhooksConstructEvent.mockReturnValue({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due' } },
      });

      await billing.handleWebhook(Buffer.from('{}'), 'sig');

      expect(organizationFindUnique).toHaveBeenCalledWith({ where: { stripeCustomerId: 'cus_1' }, select: { id: true } });
      expect(organizationUpdate).toHaveBeenCalledWith({ where: { id: 'org-1' }, data: { subscriptionStatus: SubscriptionStatus.PAST_DUE, stripeSubscriptionId: 'sub_1' } });
    });

    it('clears the subscription id on customer.subscription.deleted', async () => {
      const { service: billing, organizationFindUnique, organizationUpdate } = service();
      organizationFindUnique.mockResolvedValue({ id: 'org-1' });
      webhooksConstructEvent.mockReturnValue({
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_1', customer: 'cus_1' } },
      });

      await billing.handleWebhook(Buffer.from('{}'), 'sig');

      expect(organizationUpdate).toHaveBeenCalledWith({ where: { id: 'org-1' }, data: { subscriptionStatus: SubscriptionStatus.CANCELED, stripeSubscriptionId: null } });
    });

    it('marks the organization past due on invoice.payment_failed without touching the subscription id', async () => {
      const { service: billing, organizationFindUnique, organizationUpdate } = service();
      organizationFindUnique.mockResolvedValue({ id: 'org-1' });
      webhooksConstructEvent.mockReturnValue({
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_1' } },
      });

      await billing.handleWebhook(Buffer.from('{}'), 'sig');

      expect(organizationUpdate).toHaveBeenCalledWith({ where: { id: 'org-1' }, data: { subscriptionStatus: SubscriptionStatus.PAST_DUE } });
    });

    it('does nothing for an event kind it does not act on', async () => {
      const { service: billing, organizationUpdate } = service();
      webhooksConstructEvent.mockReturnValue({ type: 'customer.updated', data: { object: {} } });

      await billing.handleWebhook(Buffer.from('{}'), 'sig');

      expect(organizationUpdate).not.toHaveBeenCalled();
    });

    it('logs and skips when no organization matches the Stripe customer', async () => {
      const { service: billing, organizationFindUnique, organizationUpdate } = service();
      organizationFindUnique.mockResolvedValue(null);
      webhooksConstructEvent.mockReturnValue({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', customer: 'cus_unknown', status: 'active' } },
      });

      await billing.handleWebhook(Buffer.from('{}'), 'sig');

      expect(organizationUpdate).not.toHaveBeenCalled();
    });
  });
});
