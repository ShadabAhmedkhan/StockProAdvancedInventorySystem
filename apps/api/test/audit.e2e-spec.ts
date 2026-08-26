import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import {
  AuditAction,
  AuditEntity,
  DeviceType,
  ExpenseCategory,
  PaymentMethod,
  RepairStatus,
  ReturnReason,
  StockMovementType,
  UserRole,
  UserStatus,
} from '../src/generated/prisma/enums';
import { closeTestApp, createTeammate, createTestApp, inviteTeammate, refreshCookie, signInAs, TEST_PASSWORD, type TestApp } from './support/auth.helper';

interface Identified {
  id: string;
}

interface AuditBody {
  id: string;
  userId: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
}

interface OrderBody {
  id: string;
  items: { id: string }[];
}

interface RepairBody {
  id: string;
}

function body<T>(response: { body: ApiResponse<T> }): T {
  return response.body.data;
}

describe('Audit (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let managerToken: string;
  let staffToken: string;
  let technicianToken: string;
  let technicianId: string;
  let categoryId: string;
  let customerId: string;

  function as(token: string, method: 'post' | 'patch' | 'delete' | 'get', path: string): request.Test {
    return request(context.server)[method](path).set('Authorization', `Bearer ${token}`);
  }

  /** The most recent audit entry matching, so a test does not have to filter by entityId it does not yet have. */
  async function latestEntry(action: AuditAction, entityId?: string): Promise<AuditBody | undefined> {
    const query = entityId === undefined ? `action=${action}&limit=5` : `action=${action}&entityId=${entityId}&limit=5`;
    const response = await as(adminToken, 'get', `/api/v1/audit?${query}`).expect(200);
    return body<AuditBody[]>(response)[0];
  }

  /** AUTH events have no natural entityId - the actor is the subject - so these are found by userId instead. */
  async function latestEntryForUser(action: AuditAction, userId: string): Promise<AuditBody | undefined> {
    const response = await as(adminToken, 'get', `/api/v1/audit?action=${action}&userId=${userId}&limit=5`).expect(200);
    return body<AuditBody[]>(response)[0];
  }

  async function makeProduct(suffix: string, sellingPrice: string, quantity: number): Promise<string> {
    const created = await as(adminToken, 'post', '/api/v1/products')
      .send({ sku: `${label}-${suffix}`, name: `Audit ${suffix}`, categoryId, costPrice: '1.00', sellingPrice })
      .expect(201);
    const productId = body<Identified>(created).id;

    await as(adminToken, 'post', '/api/v1/stock/adjust').send({ productId, type: StockMovementType.PURCHASE, quantity }).expect(200);

    return productId;
  }

  beforeAll(async () => {
    context = await createTestApp({ throttleLimit: 5000 });
    label = `AU${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });
      await context.prisma.financialTransaction.deleteMany({ where: { createdById } });
      await context.prisma.payment.deleteMany({ where: { createdById } });
      await context.prisma.expense.deleteMany({ where: { createdById } });
      await context.prisma.return.deleteMany({ where: { createdById } });
      await context.prisma.repairStatusHistory.deleteMany({ where: { changedById: createdById } });
      await context.prisma.repair.deleteMany({ where: { customer: { customerCode: { startsWith: label } } } });
      await context.prisma.order.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.customer.deleteMany({ where: { customerCode: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'aud-admin', UserRole.ADMIN)).accessToken;
    managerToken = (await inviteTeammate(context, adminToken, 'aud-manager', UserRole.MANAGER)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'aud-staff', UserRole.STAFF)).accessToken;
    const technician = await inviteTeammate(context, adminToken, 'aud-tech', UserRole.TECHNICIAN);
    technicianToken = technician.accessToken;
    technicianId = technician.id;

    const category = await as(adminToken, 'post', '/api/v1/categories')
      .send({ name: `${label} Audit` })
      .expect(201);
    categoryId = body<Identified>(category).id;

    const customer = await as(adminToken, 'post', '/api/v1/customers')
      .send({ customerCode: `${label}-C1`, firstName: 'Audit', lastName: 'Customer', phone: '+1 555 0166' })
      .expect(201);
    customerId = body<Identified>(customer).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('refuses a non-administrator reading the trail', async () => {
    await as(staffToken, 'get', '/api/v1/audit').expect(403);
    await as(managerToken, 'get', '/api/v1/audit').expect(403);
  });

  describe('authentication', () => {
    // The login endpoint carries its own hard-coded 5-per-minute throttle,
    // separate from this suite's raised global limit, so LOGIN and LOGOUT
    // share the one real login call rather than each spending their own.
    it('records LOGIN on success and LOGOUT for the session owner', async () => {
      const user = await createTeammate(context, adminToken, 'aud-login', UserRole.STAFF);

      const login = await request(context.server).post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
      const userId = body<{ user: { id: string } }>(login).user.id;

      const loginEntry = await latestEntryForUser(AuditAction.LOGIN, userId);
      expect(loginEntry?.userId).toBe(userId);
      expect(loginEntry?.entity).toBe(AuditEntity.AUTH);

      const cookie = refreshCookie(login);
      await request(context.server)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie ?? '')
        .expect(200);

      const logoutEntry = await latestEntryForUser(AuditAction.LOGOUT, userId);
      expect(logoutEntry?.userId).toBe(userId);
    });

    it('records LOGIN_FAILED with no actor for a wrong password', async () => {
      const user = await createTeammate(context, adminToken, 'aud-wrongpw', UserRole.STAFF);

      await request(context.server).post('/api/v1/auth/login').send({ email: user.email, password: 'TotallyWrong1' }).expect(401);

      const response = await as(adminToken, 'get', `/api/v1/audit?action=${AuditAction.LOGIN_FAILED}&limit=5`).expect(200);
      const entry = body<AuditBody[]>(response)[0];
      expect(entry?.userId).toBeNull();
    });
  });

  describe('users', () => {
    it('records CREATE for a new user, attributed to the administrator', async () => {
      const created = await as(adminToken, 'post', '/api/v1/users')
        .send({
          firstName: 'New',
          lastName: 'Hire',
          email: `${label.toLowerCase()}-hire@stockpro.test`,
          password: 'CorrectHorse1',
          role: UserRole.STAFF,
          status: UserStatus.ACTIVE,
        })
        .expect(201);
      const userId = body<Identified>(created).id;
      context.createdUserIds.push(userId);

      const entry = await latestEntry(AuditAction.CREATE, userId);
      expect(entry?.entity).toBe(AuditEntity.USER);
    });

    it('records ROLE_CHANGED with the old and new role', async () => {
      const staff = await createTeammate(context, adminToken, 'aud-promote', UserRole.STAFF);

      await as(adminToken, 'patch', `/api/v1/users/${staff.id}/role`).send({ role: UserRole.MANAGER }).expect(200);

      const entry = await latestEntry(AuditAction.ROLE_CHANGED, staff.id);
      expect(entry?.metadata).toEqual({ from: UserRole.STAFF, to: UserRole.MANAGER });
    });

    it('records STATUS_CHANGED', async () => {
      const staff = await createTeammate(context, adminToken, 'aud-suspend', UserRole.STAFF);

      await as(adminToken, 'patch', `/api/v1/users/${staff.id}/status`).send({ status: UserStatus.SUSPENDED }).expect(200);

      const entry = await latestEntry(AuditAction.STATUS_CHANGED, staff.id);
      expect(entry?.metadata).toEqual({ from: UserStatus.ACTIVE, to: UserStatus.SUSPENDED });
    });
  });

  describe('products and stock', () => {
    it('records CREATE, UPDATE and DELETE for a product', async () => {
      const created = await as(adminToken, 'post', '/api/v1/products')
        .send({ sku: `${label}-LIFE`, name: 'Lifecycle product', categoryId, costPrice: '1.00', sellingPrice: '2.00' })
        .expect(201);
      const productId = body<Identified>(created).id;

      expect((await latestEntry(AuditAction.CREATE, productId))?.entity).toBe(AuditEntity.PRODUCT);

      await as(adminToken, 'patch', `/api/v1/products/${productId}`).send({ name: 'Renamed product' }).expect(200);
      expect((await latestEntry(AuditAction.UPDATE, productId))?.entity).toBe(AuditEntity.PRODUCT);

      await as(adminToken, 'delete', `/api/v1/products/${productId}`).expect(200);
      expect((await latestEntry(AuditAction.DELETE, productId))?.entity).toBe(AuditEntity.PRODUCT);
    });

    it('records STOCK_ADJUSTED against the product', async () => {
      const productId = await makeProduct('STOCK', '10.00', 20);

      const entry = await latestEntry(AuditAction.STOCK_ADJUSTED, productId);
      expect(entry?.entity).toBe(AuditEntity.INVENTORY);
    });
  });

  describe('orders', () => {
    it('records PAYMENT_RECORDED and ORDER_COMPLETED', async () => {
      const productId = await makeProduct('SALE', '30.00', 20);

      const created = await as(staffToken, 'post', '/api/v1/orders')
        .send({ customerId, items: [{ productId, quantity: 1 }] })
        .expect(201);
      const order = body<OrderBody>(created);
      await as(staffToken, 'post', `/api/v1/orders/${order.id}/confirm`).expect(200);

      const payment = await as(staffToken, 'post', `/api/v1/orders/${order.id}/payments`).send({ method: PaymentMethod.CASH, amount: '30.00' }).expect(201);
      const paymentId = body<Identified>(payment).id;
      expect((await latestEntry(AuditAction.PAYMENT_RECORDED, paymentId))?.entity).toBe(AuditEntity.PAYMENT);

      await as(staffToken, 'post', `/api/v1/orders/${order.id}/complete`).expect(200);
      expect((await latestEntry(AuditAction.ORDER_COMPLETED, order.id))?.entity).toBe(AuditEntity.ORDER);
    });

    it('records ORDER_CANCELLED', async () => {
      const created = await as(staffToken, 'post', '/api/v1/orders').send({ customerId, items: [] }).expect(201);
      const order = body<Identified>(created);

      await as(staffToken, 'post', `/api/v1/orders/${order.id}/cancel`).expect(200);

      expect((await latestEntry(AuditAction.ORDER_CANCELLED, order.id))?.entity).toBe(AuditEntity.ORDER);
    });
  });

  describe('repairs', () => {
    it('records REPAIR_STATUS_CHANGED and PAYMENT_RECORDED', async () => {
      const intake = await as(staffToken, 'post', '/api/v1/repairs')
        .send({ customerId, deviceType: DeviceType.PHONE, problemDescription: 'Speaker crackles', technicianId })
        .expect(201);
      const repair = body<RepairBody>(intake);

      await as(technicianToken, 'post', `/api/v1/repairs/${repair.id}/status`).send({ toStatus: RepairStatus.DIAGNOSING }).expect(200);
      expect((await latestEntry(AuditAction.REPAIR_STATUS_CHANGED, repair.id))?.metadata).toEqual({ from: RepairStatus.RECEIVED, to: RepairStatus.DIAGNOSING });

      await as(technicianToken, 'post', `/api/v1/repairs/${repair.id}/status`).send({ toStatus: RepairStatus.APPROVED }).expect(200);
      await as(technicianToken, 'post', `/api/v1/repairs/${repair.id}/status`).send({ toStatus: RepairStatus.IN_PROGRESS }).expect(200);
      await as(technicianToken, 'patch', `/api/v1/repairs/${repair.id}`).send({ finalCost: '40.00' }).expect(200);
      await as(technicianToken, 'post', `/api/v1/repairs/${repair.id}/status`).send({ toStatus: RepairStatus.COMPLETED }).expect(200);

      const payment = await as(staffToken, 'post', `/api/v1/repairs/${repair.id}/payments`).send({ method: PaymentMethod.CARD, amount: '40.00' }).expect(201);
      const paymentId = body<Identified>(payment).id;

      expect((await latestEntry(AuditAction.PAYMENT_RECORDED, paymentId))?.entity).toBe(AuditEntity.PAYMENT);
    });
  });

  describe('returns', () => {
    it('records RETURN_APPROVED and RETURN_COMPLETED', async () => {
      const productId = await makeProduct('RETURN', '20.00', 20);

      const created = await as(staffToken, 'post', '/api/v1/orders')
        .send({ customerId, items: [{ productId, quantity: 1 }] })
        .expect(201);
      const order = body<OrderBody>(created);
      await as(staffToken, 'post', `/api/v1/orders/${order.id}/confirm`).expect(200);
      await as(staffToken, 'post', `/api/v1/orders/${order.id}/payments`).send({ method: PaymentMethod.CASH, amount: '20.00' }).expect(201);
      await as(staffToken, 'post', `/api/v1/orders/${order.id}/complete`).expect(200);

      const raised = await as(staffToken, 'post', '/api/v1/returns')
        .send({ orderId: order.id, reason: ReturnReason.DEFECTIVE, items: [{ orderItemId: order.items[0]?.id ?? '', quantity: 1 }] })
        .expect(201);
      const returnId = body<Identified>(raised).id;

      await as(adminToken, 'post', `/api/v1/returns/${returnId}/approve`).expect(200);
      expect((await latestEntry(AuditAction.RETURN_APPROVED, returnId))?.entity).toBe(AuditEntity.RETURN);

      await as(adminToken, 'post', `/api/v1/returns/${returnId}/complete`).send({ method: PaymentMethod.CASH }).expect(200);
      expect((await latestEntry(AuditAction.RETURN_COMPLETED, returnId))?.entity).toBe(AuditEntity.RETURN);
    });
  });

  describe('finance', () => {
    it('records CREATE, UPDATE and DELETE for an expense', async () => {
      const created = await as(managerToken, 'post', '/api/v1/finance/expenses')
        .send({ category: ExpenseCategory.SUPPLIES, description: `${label} audit trail expense`, amount: '9.00' })
        .expect(201);
      const expenseId = body<Identified>(created).id;

      expect((await latestEntry(AuditAction.CREATE, expenseId))?.entity).toBe(AuditEntity.EXPENSE);

      await as(managerToken, 'patch', `/api/v1/finance/expenses/${expenseId}`).send({ amount: '11.00' }).expect(200);
      expect((await latestEntry(AuditAction.UPDATE, expenseId))?.entity).toBe(AuditEntity.EXPENSE);

      await as(managerToken, 'delete', `/api/v1/finance/expenses/${expenseId}`).expect(200);
      expect((await latestEntry(AuditAction.DELETE, expenseId))?.entity).toBe(AuditEntity.EXPENSE);
    });
  });

  it('never writes a password, a JWT or a refresh token into metadata', async () => {
    const response = await as(adminToken, 'get', '/api/v1/audit?limit=100').expect(200);
    const entries = body<AuditBody[]>(response);
    const serialized = JSON.stringify(entries.map((entry) => entry.metadata));

    expect(serialized).not.toMatch(/\$argon2/);
    expect(serialized.toLowerCase()).not.toContain('password');
    expect(serialized).not.toMatch(/eyJhbGciOi/); // a JWT header, base64url-encoded
  });
});
