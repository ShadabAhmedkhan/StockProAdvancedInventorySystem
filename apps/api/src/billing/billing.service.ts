import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import Stripe from 'stripe';
import { ErrorCode } from '../common/enums/error-code.enum';
import { appConfig } from '../config/app.config';
import { stripeConfig } from '../config/stripe.config';
import { SubscriptionStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Stripe API versions are a moving target; pinning one keeps webhook payload
 * shapes stable across a Stripe-side upgrade until this is deliberately bumped.
 */
const STRIPE_API_VERSION = '2025-09-30.clover' as Stripe.LatestApiVersion;

/** Subscription statuses Stripe reports that this app treats as "still paying". */
const STRIPE_ACTIVE_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing']);
const STRIPE_PAST_DUE_STATUSES = new Set<Stripe.Subscription.Status>(['past_due', 'unpaid', 'incomplete']);

/**
 * Talks to Stripe on the organization's behalf: starts a Checkout session for
 * a new subscription, opens the Billing Portal for an existing one, and folds
 * webhook events back into `Organization.subscriptionStatus`.
 *
 * Reads and writes `Organization` through the plain {@link PrismaService}
 * rather than the tenant-scoped client - `Organization` is deliberately absent
 * from the tenant extension's allow-list (it is the tenant, not a tenant's
 * row), and the webhook handler in particular runs with no request-scoped org
 * context to scope by in the first place.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe | undefined;

  constructor(
    @Inject(stripeConfig.KEY) private readonly config: ConfigType<typeof stripeConfig>,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
    private readonly prisma: PrismaService,
  ) {
    this.stripe = this.config.secretKey === undefined ? undefined : new Stripe(this.config.secretKey, { apiVersion: STRIPE_API_VERSION });
  }

  /** What the billing page needs to render, without exposing Stripe ids to the client. */
  async status(organizationId: string): Promise<{ subscriptionStatus: SubscriptionStatus; trialEndsAt: Date | null; canManageBilling: boolean }> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { subscriptionStatus: true, trialEndsAt: true, stripeCustomerId: true },
    });

    return {
      subscriptionStatus: organization.subscriptionStatus,
      trialEndsAt: organization.trialEndsAt,
      canManageBilling: organization.stripeCustomerId !== null,
    };
  }

  /** Starts a Checkout session for a subscription, reusing the org's existing Stripe customer if it has one. */
  async createCheckoutSession(organizationId: string, callerEmail: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const priceId = this.requirePriceId();
    const baseUrl = this.requireBaseUrl();

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard/billing?checkout=success`,
      cancel_url: `${baseUrl}/dashboard/billing?checkout=cancelled`,
      metadata: { organizationId },
      ...(organization.stripeCustomerId === null ? { customer_email: callerEmail } : { customer: organization.stripeCustomerId }),
    });

    if (session.url === null) {
      throw new ServiceUnavailableException({ code: ErrorCode.SERVICE_UNAVAILABLE, message: 'Stripe did not return a checkout URL' });
    }

    return { url: session.url };
  }

  /** Opens the Billing Portal, which requires a Stripe customer to already exist - i.e. at least one prior checkout. */
  async createPortalSession(organizationId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const baseUrl = this.requireBaseUrl();

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });

    if (organization.stripeCustomerId === null) {
      throw new BadRequestException({ code: ErrorCode.BAD_REQUEST, message: 'This organization has no billing history yet - subscribe first' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: organization.stripeCustomerId,
      return_url: `${baseUrl}/dashboard/billing`,
    });

    return { url: session.url };
  }

  /** Verifies and applies one Stripe webhook event. `rawBody` must be the exact bytes Stripe signed, not a re-serialised copy. */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const stripe = this.requireStripe();

    if (this.config.webhookSecret === undefined) {
      throw new ServiceUnavailableException({ code: ErrorCode.SERVICE_UNAVAILABLE, message: 'Billing is not configured' });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, this.config.webhookSecret);
    } catch (error) {
      throw new BadRequestException({ code: ErrorCode.BAD_REQUEST, message: `Invalid webhook signature: ${error instanceof Error ? error.message : 'unknown error'}` });
    }

    // Stripe sends dozens of event kinds; an `if` chain rather than a
    // `switch` on `event.type` avoids having to enumerate every one this
    // handler does not act on just to satisfy exhaustiveness checking.
    if (event.type === 'checkout.session.completed') {
      await this.onCheckoutCompleted(event.data.object);
    } else if (event.type === 'customer.subscription.updated') {
      await this.onSubscriptionUpdated(event.data.object);
    } else if (event.type === 'customer.subscription.deleted') {
      await this.onSubscriptionDeleted(event.data.object);
    } else if (event.type === 'invoice.payment_failed') {
      await this.onPaymentFailed(event.data.object);
    } else {
      this.logger.debug(`Ignoring unhandled Stripe event: ${event.type}`);
    }
  }

  private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const organizationId = session.metadata?.organizationId;
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

    if (organizationId === undefined || customerId === undefined) {
      this.logger.warn(`checkout.session.completed missing organizationId or customer: session ${session.id}`);
      return;
    }

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId ?? null, subscriptionStatus: SubscriptionStatus.ACTIVE },
    });
  }

  private async onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    await this.updateByCustomerId(subscription.customer, subscription.id, this.mapStatus(subscription.status));
  }

  private async onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    await this.updateByCustomerId(subscription.customer, null, SubscriptionStatus.CANCELED);
  }

  private async onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.customer === null) {
      return;
    }
    await this.updateByCustomerId(invoice.customer, undefined, SubscriptionStatus.PAST_DUE);
  }

  /** `undefined` leaves `stripeSubscriptionId` untouched; `null` explicitly clears it. */
  private async updateByCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer, stripeSubscriptionId: string | null | undefined, subscriptionStatus: SubscriptionStatus): Promise<void> {
    const customerId = typeof customer === 'string' ? customer : customer.id;

    const organization = await this.prisma.organization.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } });
    if (organization === null) {
      this.logger.warn(`No organization found for Stripe customer ${customerId}`);
      return;
    }

    await this.prisma.organization.update({
      where: { id: organization.id },
      data: { subscriptionStatus, ...(stripeSubscriptionId === undefined ? {} : { stripeSubscriptionId }) },
    });
  }

  private mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
    if (STRIPE_ACTIVE_STATUSES.has(status)) {
      return status === 'trialing' ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE;
    }
    if (STRIPE_PAST_DUE_STATUSES.has(status)) {
      return SubscriptionStatus.PAST_DUE;
    }
    return SubscriptionStatus.CANCELED;
  }

  private requireStripe(): Stripe {
    if (this.stripe === undefined) {
      throw new ServiceUnavailableException({ code: ErrorCode.SERVICE_UNAVAILABLE, message: 'Billing is not configured' });
    }
    return this.stripe;
  }

  private requirePriceId(): string {
    if (this.config.priceId === undefined) {
      throw new ServiceUnavailableException({ code: ErrorCode.SERVICE_UNAVAILABLE, message: 'Billing is not configured' });
    }
    return this.config.priceId;
  }

  private requireBaseUrl(): string {
    const origin = this.app.corsOrigins[0];
    if (origin === undefined) {
      throw new ServiceUnavailableException({ code: ErrorCode.SERVICE_UNAVAILABLE, message: 'No web origin configured to redirect back to' });
    }
    return origin;
  }
}
