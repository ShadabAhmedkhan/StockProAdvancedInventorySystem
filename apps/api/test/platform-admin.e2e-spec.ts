import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { hashPassword } from '../src/common/utils/password.util';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { closeTestApp, createTestApp, registerUser, type TestApp } from './support/auth.helper';

const PLATFORM_ADMIN_PASSWORD = 'PlatformOperator1!';
const ONE_MINUTE_MS = 60_000;
const ONE_DAY_MS = 24 * 60 * ONE_MINUTE_MS;

interface OrganizationSummaryBody {
  id: string;
  name: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  userCount: number;
}

interface OrganizationUserBody {
  id: string;
  email: string;
  role: string;
  status: string;
}

interface OrganizationActivityBody {
  action: string;
  metadata: Record<string, unknown> | null;
}

interface PlatformSessionBody {
  accessToken: string;
}

function body<T>(response: { body: ApiResponse<T> }): T {
  return response.body.data;
}

describe('Platform admin (e2e)', () => {
  let context: TestApp;
  let platformAdminEmail: string;
  /** Logged in once in `beforeAll` and reused: the login route's 5-per-minute
   * throttle is shared across this whole file, and only the dedicated login
   * test below needs to exercise it more than once. */
  let platformAdminToken: string;

  beforeAll(async () => {
    context = await createTestApp();

    platformAdminEmail = `e2e-platform-admin-${context.run}@stockpro.test`;
    const passwordHash = await hashPassword(PLATFORM_ADMIN_PASSWORD);
    await context.prisma.platformAdmin.create({ data: { email: platformAdminEmail, passwordHash } });
    context.cleanup.push(async () => {
      await context.prisma.platformAdmin.deleteMany({ where: { email: platformAdminEmail } });
    });

    const response = await request(context.server)
      .post('/api/v1/platform-admin/auth/login')
      .send({ email: platformAdminEmail, password: PLATFORM_ADMIN_PASSWORD })
      .expect(200);
    platformAdminToken = body<PlatformSessionBody>(response).accessToken;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('rejects an unknown email and a wrong password identically', async () => {
    await request(context.server)
      .post('/api/v1/platform-admin/auth/login')
      .send({ email: `unknown-${randomUUID()}@stockpro.test`, password: 'whatever1' })
      .expect(401);
    await request(context.server).post('/api/v1/platform-admin/auth/login').send({ email: platformAdminEmail, password: 'wrong-password' }).expect(401);
  });

  it('lists organizations from both an Org A and an Org B registration, with user counts', async () => {
    const orgA = await registerUser(context, `plat-a-${randomUUID().slice(0, 6)}`);
    const orgB = await registerUser(context, `plat-b-${randomUUID().slice(0, 6)}`);
    const orgAId = await organizationIdFor(context, orgA.id);
    const orgBId = await organizationIdFor(context, orgB.id);

    const response = await request(context.server).get('/api/v1/platform-admin/organizations').set('Authorization', `Bearer ${platformAdminToken}`).expect(200);

    const organizations = body<OrganizationSummaryBody[]>(response);
    const foundA = organizations.find((org) => org.id === orgAId);
    const foundB = organizations.find((org) => org.id === orgBId);

    expect(foundA).toBeDefined();
    expect(foundB).toBeDefined();
    expect(foundA?.userCount).toBe(1);
    expect(foundB?.userCount).toBe(1);
    expect(foundA?.subscriptionStatus).toBe('TRIALING');
  });

  it("returns exactly that org's users - identity fields only", async () => {
    const admin = await registerUser(context, `plat-users-${randomUUID().slice(0, 6)}`);
    const orgId = await organizationIdFor(context, admin.id);

    const response = await request(context.server)
      .get(`/api/v1/platform-admin/organizations/${orgId}/users`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);

    const users = body<OrganizationUserBody[]>(response);
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe(admin.email);
    expect(users[0]?.role).toBe('ADMIN');
    expect(Object.keys(users[0] ?? {})).not.toContain('passwordHash');
  });

  it('404s for an organization that does not exist', async () => {
    await request(context.server)
      .get(`/api/v1/platform-admin/organizations/${randomUUID()}/users`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(404);
  });

  it('suspending an organization locks its own admin out with 402, reactivating restores access', async () => {
    const admin = await registerUser(context, `plat-suspend-${randomUUID().slice(0, 6)}`);
    const orgId = await organizationIdFor(context, admin.id);

    await request(context.server).get('/api/v1/customers').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);

    const suspended = await request(context.server)
      .patch(`/api/v1/platform-admin/organizations/${orgId}/suspend`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);
    expect(body<OrganizationSummaryBody>(suspended).subscriptionStatus).toBe('SUSPENDED');

    await request(context.server)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(402)
      .expect((response: request.Response) => {
        expect((response.body as { code: string }).code).toBe('SUBSCRIPTION_EXPIRED');
      });

    const reactivated = await request(context.server)
      .patch(`/api/v1/platform-admin/organizations/${orgId}/reactivate`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);
    expect(body<OrganizationSummaryBody>(reactivated).subscriptionStatus).toBe('TRIALING');

    await request(context.server).get('/api/v1/customers').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
  });

  it('extending a lapsed trial restarts it from today, restores access and is recorded as platform activity', async () => {
    const admin = await registerUser(context, `plat-lapsed-${randomUUID().slice(0, 6)}`);
    const orgId = await organizationIdFor(context, admin.id);
    await context.prisma.organization.update({ where: { id: orgId }, data: { trialEndsAt: new Date(Date.now() - ONE_DAY_MS) } });

    await request(context.server).get('/api/v1/customers').set('Authorization', `Bearer ${admin.accessToken}`).expect(402);

    const extended = await request(context.server)
      .patch(`/api/v1/platform-admin/organizations/${orgId}/trial`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ days: 7 })
      .expect(200);

    const organization = body<OrganizationSummaryBody>(extended);
    expect(organization.subscriptionStatus).toBe('TRIALING');
    expect(Math.abs(new Date(organization.trialEndsAt ?? 0).getTime() - (Date.now() + 7 * ONE_DAY_MS))).toBeLessThan(ONE_MINUTE_MS);

    await request(context.server).get('/api/v1/customers').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);

    const activity = await request(context.server)
      .get(`/api/v1/platform-admin/organizations/${orgId}/activity`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);
    const [latest] = body<OrganizationActivityBody[]>(activity);
    expect(latest?.action).toBe('UPDATE');
    expect(latest?.metadata).toMatchObject({ extendedByDays: 7, actor: platformAdminEmail });
  });

  it('two simultaneous extensions of a running trial both add to its current end date', async () => {
    const admin = await registerUser(context, `plat-extend-${randomUUID().slice(0, 6)}`);
    const orgId = await organizationIdFor(context, admin.id);
    const before = await context.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { trialEndsAt: true } });

    await Promise.all(
      [5, 5].map((days) =>
        request(context.server)
          .patch(`/api/v1/platform-admin/organizations/${orgId}/trial`)
          .set('Authorization', `Bearer ${platformAdminToken}`)
          .send({ days })
          .expect(200),
      ),
    );

    const after = await context.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { trialEndsAt: true } });
    expect((after.trialEndsAt?.getTime() ?? 0) - (before.trialEndsAt?.getTime() ?? 0)).toBe(10 * ONE_DAY_MS);
  });

  it('refuses to extend the trial of a paying organization and leaves it ACTIVE', async () => {
    const admin = await registerUser(context, `plat-active-${randomUUID().slice(0, 6)}`);
    const orgId = await organizationIdFor(context, admin.id);
    await context.prisma.organization.update({ where: { id: orgId }, data: { subscriptionStatus: 'ACTIVE' } });

    await request(context.server)
      .patch(`/api/v1/platform-admin/organizations/${orgId}/trial`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ days: 7 })
      .expect(409)
      .expect((response: request.Response) => {
        expect((response.body as { code: string }).code).toBe('CONFLICT');
      });

    const organization = await context.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { subscriptionStatus: true } });
    expect(organization.subscriptionStatus).toBe('ACTIVE');
  });

  it('extending a suspended organization moves the date but keeps it suspended until reactivated', async () => {
    const admin = await registerUser(context, `plat-susp-ext-${randomUUID().slice(0, 6)}`);
    const orgId = await organizationIdFor(context, admin.id);

    await request(context.server)
      .patch(`/api/v1/platform-admin/organizations/${orgId}/suspend`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);

    const extended = await request(context.server)
      .patch(`/api/v1/platform-admin/organizations/${orgId}/trial`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ days: 30 })
      .expect(200);
    expect(body<OrganizationSummaryBody>(extended).subscriptionStatus).toBe('SUSPENDED');

    await request(context.server).get('/api/v1/customers').set('Authorization', `Bearer ${admin.accessToken}`).expect(402);

    const reactivated = await request(context.server)
      .patch(`/api/v1/platform-admin/organizations/${orgId}/reactivate`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);
    expect(body<OrganizationSummaryBody>(reactivated).subscriptionStatus).toBe('TRIALING');
  });

  it.each([0, 366, 2.5, 'seven'])('rejects a trial extension of %p days', async (days) => {
    await request(context.server)
      .patch(`/api/v1/platform-admin/organizations/${randomUUID()}/trial`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ days })
      .expect(400);
  });

  it('404s when extending the trial of an organization that does not exist', async () => {
    await request(context.server)
      .patch(`/api/v1/platform-admin/organizations/${randomUUID()}/trial`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ days: 7 })
      .expect(404);
  });

  it('never authenticates a tenant access token on a platform-admin route', async () => {
    const admin = await registerUser(context, `plat-cross-a-${randomUUID().slice(0, 6)}`);
    await request(context.server).get('/api/v1/platform-admin/organizations').set('Authorization', `Bearer ${admin.accessToken}`).expect(401);
  });

  it('never authenticates a platform-admin token on a tenant route', async () => {
    await request(context.server).get('/api/v1/auth/me').set('Authorization', `Bearer ${platformAdminToken}`).expect(401);
  });
});

/** The registration response carries the user, not the org id directly - read it back from the row. */
async function organizationIdFor(context: TestApp, userId: string): Promise<string> {
  const user = await context.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { organizationId: true } });
  return user.organizationId;
}
