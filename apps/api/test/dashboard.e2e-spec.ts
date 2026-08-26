import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { ExpenseCategory, PaymentMethod, StockMovementType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

interface Identified {
  id: string;
}

interface OrderBody {
  id: string;
  orderNumber: string;
}

interface DashboardBody {
  sales: { totalOrders: number; today: string; thisMonth: string; grossRevenue: string };
  finance: { expenses: string; netPosition: string };
  inventory: { totalProducts: number; totalUnits: number; lowStockCount: number; outOfStockCount: number };
  repairs: { active: number; completed: number; statusDistribution: Record<string, number> };
  returns: { pending: number };
  customers: { total: number };
  recentSales: { id: string; orderNumber: string }[];
  recentStockMovements: { id: string; productId: string }[];
  salesChart: { date: string; revenue: string }[];
}

function body<T>(response: { body: ApiResponse<T> }): T {
  return response.body.data;
}

describe('Dashboard (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let staffToken: string;
  let categoryId: string;
  let customerId: string;

  function as(token: string, method: 'post' | 'get', path: string): request.Test {
    return request(context.server)[method](path).set('Authorization', `Bearer ${token}`);
  }

  async function dashboard(): Promise<DashboardBody> {
    const response = await as(adminToken, 'get', '/api/v1/dashboard').expect(200);
    return body<DashboardBody>(response);
  }

  async function makeProduct(suffix: string, sellingPrice: string, quantity: number): Promise<string> {
    const created = await as(adminToken, 'post', '/api/v1/products')
      .send({ sku: `${label}-${suffix}`, name: `Dashboard ${suffix}`, categoryId, costPrice: '1.00', sellingPrice })
      .expect(201);

    const productId = body<Identified>(created).id;
    await as(adminToken, 'post', '/api/v1/stock/adjust').send({ productId, type: StockMovementType.PURCHASE, quantity }).expect(200);

    return productId;
  }

  async function paidOrder(productId: string, amount: string): Promise<OrderBody> {
    const created = await as(staffToken, 'post', '/api/v1/orders')
      .send({ customerId, items: [{ productId, quantity: 1 }] })
      .expect(201);
    const order = body<OrderBody>(created);

    await as(staffToken, 'post', `/api/v1/orders/${order.id}/confirm`).expect(200);
    await as(staffToken, 'post', `/api/v1/orders/${order.id}/payments`).send({ method: PaymentMethod.CASH, amount }).expect(201);
    await as(staffToken, 'post', `/api/v1/orders/${order.id}/complete`).expect(200);

    return order;
  }

  beforeAll(async () => {
    context = await createTestApp({ throttleLimit: 5000 });
    label = `DB${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });

      await context.prisma.financialTransaction.deleteMany({ where: { createdById } });
      await context.prisma.payment.deleteMany({ where: { createdById } });
      await context.prisma.expense.deleteMany({ where: { createdById } });
      await context.prisma.order.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.customer.deleteMany({ where: { customerCode: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'dash-admin', UserRole.ADMIN)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'dash-staff', UserRole.STAFF)).accessToken;

    const category = await as(adminToken, 'post', '/api/v1/categories')
      .send({ name: `${label} Dashboard` })
      .expect(201);
    categoryId = body<Identified>(category).id;

    const customer = await as(adminToken, 'post', '/api/v1/customers')
      .send({ customerCode: `${label}-C1`, firstName: 'Dash', lastName: 'Board', phone: '+1 555 0188' })
      .expect(201);
    customerId = body<Identified>(customer).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('returns every documented section', async () => {
    const result = await dashboard();

    expect(result.sales).toBeDefined();
    expect(result.finance).toBeDefined();
    expect(result.inventory).toBeDefined();
    expect(result.repairs).toBeDefined();
    expect(result.returns).toBeDefined();
    expect(result.customers).toBeDefined();
    expect(Array.isArray(result.recentSales)).toBe(true);
    expect(Array.isArray(result.recentStockMovements)).toBe(true);
    expect(Array.isArray(result.salesChart)).toBe(true);
  });

  it('carries a two-week sales chart ending today', () => {
    return dashboard().then((result) => {
      expect(result.salesChart).toHaveLength(14);
      expect(result.salesChart.at(-1)?.date).toBe(new Date().toISOString().slice(0, 10));
    });
  });

  it("adds a completed order's payment into today's and the gross revenue figures", async () => {
    const before = await dashboard();

    const productId = await makeProduct('SALE', '35.00', 20);
    await paidOrder(productId, '35.00');

    const after = await dashboard();

    expect((Number(after.sales.today) - Number(before.sales.today)).toFixed(2)).toBe('35.00');
    expect((Number(after.sales.grossRevenue) - Number(before.sales.grossRevenue)).toFixed(2)).toBe('35.00');
    expect(after.sales.totalOrders).toBe(before.sales.totalOrders + 1);
  });

  it('adds a recorded expense into the expenses and reduces net position', async () => {
    const before = await dashboard();

    await as(adminToken, 'post', '/api/v1/finance/expenses')
      .send({ category: ExpenseCategory.SUPPLIES, description: `${label} dashboard expense`, amount: '12.00' })
      .expect(201);

    const after = await dashboard();

    expect((Number(after.finance.expenses) - Number(before.finance.expenses)).toFixed(2)).toBe('12.00');
    expect((Number(before.finance.netPosition) - Number(after.finance.netPosition)).toFixed(2)).toBe('12.00');
  });

  it('lists a freshly completed order among recent sales', async () => {
    const productId = await makeProduct('RECENT', '15.00', 20);
    const order = await paidOrder(productId, '15.00');

    const result = await dashboard();

    expect(result.recentSales.some((sale) => sale.orderNumber === order.orderNumber)).toBe(true);
  });

  it('lists a freshly adjusted product among recent stock movements', async () => {
    const productId = await makeProduct('MOVE', '9.00', 5);

    const result = await dashboard();

    expect(result.recentStockMovements.some((movement) => movement.productId === productId)).toBe(true);
  });
});
