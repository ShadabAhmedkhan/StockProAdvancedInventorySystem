import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

interface AutomationRule {
  id: string;
  name: string;
  triggerType: string;
  conditions: { field: string; operator: string; value: string }[];
  actionRoles: string[];
  isActive: boolean;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
}

/**
 * Automation rules ride on the same trigger sites Phase 38's notifications
 * already exercise (order completion, stock thresholds...), so this checks
 * the WHEN/IF/THEN behaviour end to end against a real LOW_STOCK crossing
 * rather than unit-testing the condition matcher in isolation (that lives in
 * `evaluate-automation.spec.ts`).
 */
describe('Automation rules (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let staffToken: string;

  function body<T>(response: { body: ApiResponse<T> }): T {
    return response.body.data;
  }

  function post(token: string, path: string, payload: Record<string, unknown> = {}): request.Test {
    return request(context.server).post(path).set('Authorization', `Bearer ${token}`).send(payload);
  }

  function get(token: string, path: string): request.Test {
    return request(context.server).get(path).set('Authorization', `Bearer ${token}`);
  }

  async function makeCategory(suffix: string): Promise<{ id: string; name: string }> {
    const name = `${label} ${suffix}`;
    const created = await post(adminToken, '/api/v1/categories', { name }).expect(201);
    return { id: body<{ id: string }>(created).id, name };
  }

  async function makeProduct(suffix: string, categoryId: string, minimumStock: number): Promise<{ id: string; name: string }> {
    const name = `Automation ${suffix}`;
    const created = await post(adminToken, '/api/v1/products', {
      sku: `${label}-${suffix}`,
      name,
      categoryId,
      costPrice: '5.00',
      sellingPrice: '10.00',
      minimumStock,
    }).expect(201);
    return { id: body<{ id: string }>(created).id, name };
  }

  async function stockAdjust(productId: string, type: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT', quantity: number): Promise<void> {
    await post(adminToken, '/api/v1/stock/adjust', { productId, type, quantity }).expect(200);
  }

  async function staffNotifications(): Promise<Notification[]> {
    const response = await get(staffToken, '/api/v1/notifications?limit=100').expect(200);
    return body<Notification[]>(response);
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `AUTO${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.automationRule.deleteMany({ where: { createdById } });
      await context.prisma.notification.deleteMany({ where: { userId: { in: context.createdUserIds } } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'automation-lifecycle', UserRole.ADMIN)).accessToken;

    const staff = await inviteTeammate(context, adminToken, 'automation-staff', UserRole.STAFF);
    staffToken = staff.accessToken;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('fires the rule and notifies its configured role when every condition matches', async () => {
    const category = await makeCategory('Laptops');
    const product = await makeProduct('MATCH', category.id, 5);
    await stockAdjust(product.id, 'ADJUSTMENT_IN', 10);

    const created = await post(adminToken, '/api/v1/automation-rules', {
      name: `${label} rule`,
      triggerType: 'LOW_STOCK',
      conditions: [{ field: 'categoryName', operator: 'EQUALS', value: category.name }],
      actionRoles: ['STAFF'],
    }).expect(201);
    const rule = body<AutomationRule>(created);
    expect(rule.isActive).toBe(true);

    // 10 - 6 = 4, at or below minimumStock(5): a LOW_STOCK crossing.
    await stockAdjust(product.id, 'ADJUSTMENT_OUT', 6);

    const notifications = await staffNotifications();
    const match = notifications.find((n) => n.message.includes(product.name));
    expect(match).toBeDefined();
    expect(match?.title).toContain(rule.name);
  });

  it('does not fire when a condition does not match', async () => {
    const matchingCategory = await makeCategory('Phones');
    const otherCategory = await makeCategory('Accessories');
    const product = await makeProduct('NOMATCH', otherCategory.id, 5);
    await stockAdjust(product.id, 'ADJUSTMENT_IN', 10);

    await post(adminToken, '/api/v1/automation-rules', {
      name: `${label} phones-only rule`,
      triggerType: 'LOW_STOCK',
      conditions: [{ field: 'categoryName', operator: 'EQUALS', value: matchingCategory.name }],
      actionRoles: ['STAFF'],
    }).expect(201);

    await stockAdjust(product.id, 'ADJUSTMENT_OUT', 6);

    const notifications = await staffNotifications();
    const match = notifications.find((n) => n.message.includes(product.name));
    expect(match).toBeUndefined();
  });

  it('does not fire once the rule is deactivated', async () => {
    const category = await makeCategory('Cables');
    const product = await makeProduct('DISABLED', category.id, 5);
    await stockAdjust(product.id, 'ADJUSTMENT_IN', 10);

    const created = await post(adminToken, '/api/v1/automation-rules', {
      name: `${label} disabled rule`,
      triggerType: 'LOW_STOCK',
      conditions: [],
      actionRoles: ['STAFF'],
    }).expect(201);
    const rule = body<AutomationRule>(created);

    await request(context.server)
      .patch(`/api/v1/automation-rules/${rule.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);

    await stockAdjust(product.id, 'ADJUSTMENT_OUT', 6);

    const notifications = await staffNotifications();
    const match = notifications.find((n) => n.message.includes(product.name));
    expect(match).toBeUndefined();
  });

  it('rejects a rule with no configured recipient roles', async () => {
    const response = await post(adminToken, '/api/v1/automation-rules', {
      name: `${label} broken rule`,
      triggerType: 'LOW_STOCK',
      conditions: [],
      actionRoles: [],
    }).expect(400);

    expect((response.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unsupported trigger type', async () => {
    const response = await post(adminToken, '/api/v1/automation-rules', {
      name: `${label} bad trigger`,
      triggerType: 'TRIAL_EXPIRING',
      actionRoles: ['ADMIN'],
    }).expect(400);

    expect((response.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('deletes a rule', async () => {
    const created = await post(adminToken, '/api/v1/automation-rules', {
      name: `${label} to delete`,
      triggerType: 'ORDER_COMPLETED',
      actionRoles: ['ADMIN'],
    }).expect(201);
    const rule = body<AutomationRule>(created);

    await request(context.server).delete(`/api/v1/automation-rules/${rule.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    await request(context.server).get(`/api/v1/automation-rules/${rule.id}`).set('Authorization', `Bearer ${adminToken}`).expect(404);
  });
});
