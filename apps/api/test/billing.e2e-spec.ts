import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import Stripe from 'stripe';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { AuthResult } from '../src/auth/dto/auth-response.dto';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { appConfig, type AppConfiguration } from '../src/config/app.config';
import { stripeConfig, type StripeConfiguration } from '../src/config/stripe.config';
import { SubscriptionStatus } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';

const STRIPE_SECRET_KEY = 'sk_test_e2e_00000000000000000000000';
const STRIPE_WEBHOOK_SECRET = 'whsec_e2e_test_secret';

/**
 * Signs a payload exactly the way Stripe would, using the SDK's own test
 * helper - a pure HMAC computation, no network call - so the webhook route's
 * real signature verification (not a mock of it) runs against a real payload.
 */
function signedWebhook(event: Record<string, unknown>): { payload: string; signature: string } {
  const payload = JSON.stringify(event);
  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });
  return { payload, signature };
}

/**
 * Exercises the Stripe webhook end to end against the real API and database:
 * a real signature is verified by the real handler, and the resulting
 * `Organization` row is read back from Postgres - not asserted through a
 * mocked Prisma call, as `billing.service.spec.ts` already does for every
 * branch of the event-handling logic in isolation.
 */
describe('Billing webhook (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let run: string;
  let createdUserIds: string[];
  let createdOrganizationIds: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(stripeConfig.KEY)
      .useValue({ secretKey: STRIPE_SECRET_KEY, webhookSecret: STRIPE_WEBHOOK_SECRET, priceId: 'price_e2e' } satisfies StripeConfiguration)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app, app.get<AppConfiguration>(appConfig.KEY));
    await app.init();

    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    run = randomUUID().slice(0, 8);
    createdUserIds = [];
    createdOrganizationIds = [];
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdOrganizationIds.length > 0) {
      // Stripe ids carry a unique constraint, so a leftover row from a
      // previous run would collide with this run's freshly-reused literal.
      await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
    }
    await app.close();
  });

  async function registerOrganization(label: string): Promise<{ organizationId: string }> {
    const email = `e2e-billing-${label}-${run}@stockpro.test`;
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({ firstName: 'Test', lastName: label, email, password: 'CorrectHorse1', organizationName: `Org Billing ${label} ${run}` })
      .expect(201);

    const body = response.body as ApiResponse<AuthResult>;
    createdUserIds.push(body.data.user.id);
    createdOrganizationIds.push(body.data.user.organizationId);
    return { organizationId: body.data.user.organizationId };
  }

  /** Every Stripe id in this file is scoped to `run`, since `stripeCustomerId` carries a real unique constraint that would otherwise collide with a previous run's row. */
  function stripeId(prefix: string, label: string): string {
    return `${prefix}_e2e_${label}_${run}`;
  }

  it('rejects a payload with an invalid signature', async () => {
    const payload = JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed', data: { object: {} } });

    const response = await request(server)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=not-a-real-signature')
      .send(payload)
      .expect(400);

    expect((response.body as ApiErrorResponse).code).toBe('BAD_REQUEST');
  });

  it('rejects a request with no signature header at all', async () => {
    await request(server).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').send('{}').expect(400);
  });

  it('activates the organization in the real database on checkout.session.completed', async () => {
    const { organizationId } = await registerOrganization('checkout');
    const customerId = stripeId('cus', 'checkout');
    const subscriptionId = stripeId('sub', 'checkout');
    const { payload, signature } = signedWebhook({
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: { object: { id: stripeId('cs', 'checkout'), customer: customerId, subscription: subscriptionId, metadata: { organizationId } } },
    });

    await request(server).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload).expect(200);

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(organization.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(organization.stripeCustomerId).toBe(customerId);
    expect(organization.stripeSubscriptionId).toBe(subscriptionId);
  });

  it('marks the organization past due in the real database on invoice.payment_failed', async () => {
    const { organizationId } = await registerOrganization('payment-failed');
    const customerId = stripeId('cus', 'payment-failed');
    const activate = signedWebhook({
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: { object: { id: stripeId('cs', 'payment-failed'), customer: customerId, subscription: stripeId('sub', 'payment-failed'), metadata: { organizationId } } },
    });
    await request(server).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', activate.signature).send(activate.payload).expect(200);

    const fail = signedWebhook({
      id: `evt_${randomUUID()}`,
      type: 'invoice.payment_failed',
      data: { object: { customer: customerId } },
    });
    await request(server).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', fail.signature).send(fail.payload).expect(200);

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(organization.subscriptionStatus).toBe(SubscriptionStatus.PAST_DUE);
  });

  it('cancels the subscription in the real database on customer.subscription.deleted', async () => {
    const { organizationId } = await registerOrganization('deleted');
    const customerId = stripeId('cus', 'deleted');
    const subscriptionId = stripeId('sub', 'deleted');
    const activate = signedWebhook({
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: { object: { id: stripeId('cs', 'deleted'), customer: customerId, subscription: subscriptionId, metadata: { organizationId } } },
    });
    await request(server).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', activate.signature).send(activate.payload).expect(200);

    const deleted = signedWebhook({
      id: `evt_${randomUUID()}`,
      type: 'customer.subscription.deleted',
      data: { object: { id: subscriptionId, customer: customerId } },
    });
    await request(server).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', deleted.signature).send(deleted.payload).expect(200);

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(organization.subscriptionStatus).toBe(SubscriptionStatus.CANCELED);
    expect(organization.stripeSubscriptionId).toBeNull();
  });

  it('leaves the database untouched for an event kind the handler does not act on', async () => {
    const { organizationId } = await registerOrganization('ignored');
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

    const { payload, signature } = signedWebhook({ id: `evt_${randomUUID()}`, type: 'customer.updated', data: { object: {} } });
    await request(server).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload).expect(200);

    const after = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(after).toEqual(before);
  });

  it('does not enforce tenant or auth context on the webhook route, since Stripe carries neither', async () => {
    const { payload, signature } = signedWebhook({
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: { object: { id: stripeId('cs', 'no-org'), customer: stripeId('cus', 'no-org'), subscription: null, metadata: {} } },
    });

    // No organizationId in metadata: the handler logs and skips rather than
    // erroring, so an unmatched event never surfaces as a 4xx/5xx to Stripe.
    await request(server).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload).expect(200);
  });
});
