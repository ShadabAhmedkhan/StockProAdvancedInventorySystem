import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { PaymentMethod, RepairStatus, StockMovementType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

interface Identified {
  id: string;
}

interface OrderBody {
  id: string;
}

interface SalesReportBody {
  from: string | null;
  to: string | null;
  groupBy: string;
  points: { period: string; orders: number; total: string }[];
  totals: { orders: number; subtotal: string; discount: string; tax: string; total: string };
}

interface InventoryReportBody {
  categories: { categoryId: string; categoryName: string; productCount: number; totalUnits: number; valueAtRetail: string }[];
  totals: { totalProducts: number };
}

interface TopProductBody {
  productId: string;
  sku: string;
  quantitySold: number;
  revenue: string;
}

interface AdvancedAnalyticsBody {
  sales: { orderCount: number; revenue: string; grossProfit: string; margin: string; averageOrderValue: string; discountRate: string; returnRate: string };
  inventory: { deadStockCount: number; stockTurnover: string | null };
  purchasing: { suppliers: { supplierId: string; orderCount: number; totalSpend: string; avgLeadTimeDays: number | null; onTimeRate: string | null }[] };
  repairs: {
    completionRate: string;
    avgTurnaroundDays: number | null;
    repairRevenue: string;
    technicianWorkload: { technicianId: string; activeCount: number }[];
  };
}

function body<T>(response: { body: ApiResponse<T> }): T {
  return response.body.data;
}

describe('Reports (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let staffToken: string;
  let categoryId: string;
  let customerId: string;

  function as(token: string, method: 'post' | 'get' | 'patch', path: string): request.Test {
    return request(context.server)[method](path).set('Authorization', `Bearer ${token}`);
  }

  async function makeProduct(suffix: string, sellingPrice: string, quantity: number): Promise<string> {
    const created = await as(adminToken, 'post', '/api/v1/products')
      .send({ sku: `${label}-${suffix}`, name: `Report ${suffix}`, categoryId, costPrice: '1.00', sellingPrice })
      .expect(201);

    const productId = body<Identified>(created).id;
    await as(adminToken, 'post', '/api/v1/stock/adjust').send({ productId, type: StockMovementType.PURCHASE, quantity }).expect(200);

    return productId;
  }

  async function soldOrder(productId: string, quantity: number, amount: string): Promise<OrderBody> {
    const created = await as(staffToken, 'post', '/api/v1/orders')
      .send({ customerId, items: [{ productId, quantity }] })
      .expect(201);
    const order = body<OrderBody>(created);

    await as(staffToken, 'post', `/api/v1/orders/${order.id}/confirm`).expect(200);
    await as(staffToken, 'post', `/api/v1/orders/${order.id}/payments`).send({ method: PaymentMethod.CASH, amount }).expect(201);
    await as(staffToken, 'post', `/api/v1/orders/${order.id}/complete`).expect(200);

    return order;
  }

  beforeAll(async () => {
    context = await createTestApp({ throttleLimit: 5000 });
    label = `RP${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });

      await context.prisma.financialTransaction.deleteMany({ where: { createdById } });
      await context.prisma.payment.deleteMany({ where: { createdById } });
      await context.prisma.return.deleteMany({ where: { createdById } });
      await context.prisma.repairStatusHistory.deleteMany({ where: { changedById: createdById } });
      await context.prisma.repair.deleteMany({ where: { customer: { customerCode: { startsWith: label } } } });
      await context.prisma.goodsReceiptItem.deleteMany({ where: { goodsReceipt: { createdById } } });
      await context.prisma.goodsReceipt.deleteMany({ where: { createdById } });
      await context.prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { createdById } } });
      await context.prisma.purchaseOrder.deleteMany({ where: { createdById } });
      await context.prisma.order.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.customer.deleteMany({ where: { customerCode: { startsWith: label } } });
      await context.prisma.supplier.deleteMany({ where: { name: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'rpt-admin', UserRole.ADMIN)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'rpt-staff', UserRole.STAFF)).accessToken;

    const category = await as(adminToken, 'post', '/api/v1/categories')
      .send({ name: `${label} Reports` })
      .expect(201);
    categoryId = body<Identified>(category).id;

    const customer = await as(adminToken, 'post', '/api/v1/customers')
      .send({ customerCode: `${label}-C1`, firstName: 'Report', lastName: 'Customer', phone: '+1 555 0199' })
      .expect(201);
    customerId = body<Identified>(customer).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('sales', () => {
    it('sums exactly what was sold inside a tightly bounded window', async () => {
      const from = new Date();

      const productId = await makeProduct('SALESREP', '25.00', 20);
      await soldOrder(productId, 1, '25.00');
      await soldOrder(productId, 1, '25.00');

      const to = new Date(Date.now() + 1000);

      const response = await as(adminToken, 'get', `/api/v1/reports/sales?groupBy=day&from=${from.toISOString()}&to=${to.toISOString()}`).expect(200);
      const report = body<SalesReportBody>(response);

      expect(report.totals.orders).toBe(2);
      expect(report.totals.total).toBe('50.00');
      expect(report.points).toHaveLength(1);
    });

    it('reports nothing rather than a phantom point when the window is empty', async () => {
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      const response = await as(adminToken, 'get', `/api/v1/reports/sales?from=${farFuture.toISOString()}`).expect(200);
      const report = body<SalesReportBody>(response);

      expect(report.points).toEqual([]);
      expect(report.totals.orders).toBe(0);
    });

    it('rejects a grouping outside day, week and month', async () => {
      await as(adminToken, 'get', '/api/v1/reports/sales?groupBy=year').expect(400);
    });
  });

  describe('inventory', () => {
    it('breaks the valuation down by category, adding exactly what was stocked', async () => {
      const before = await as(adminToken, 'get', '/api/v1/reports/inventory').expect(200);
      const beforeRow = body<InventoryReportBody>(before).categories.find((category) => category.categoryId === categoryId);

      await makeProduct('INV1', '10.00', 5);
      await makeProduct('INV2', '20.00', 3);

      const after = await as(adminToken, 'get', '/api/v1/reports/inventory').expect(200);
      const afterRow = body<InventoryReportBody>(after).categories.find((category) => category.categoryId === categoryId);

      expect(afterRow?.productCount).toBe((beforeRow?.productCount ?? 0) + 2);
      expect(afterRow?.totalUnits).toBe((beforeRow?.totalUnits ?? 0) + 8);
      // 5 units at 10.00 retail + 3 units at 20.00 retail.
      expect(Number(afterRow?.valueAtRetail) - Number(beforeRow?.valueAtRetail ?? '0')).toBeCloseTo(110, 2);
    });

    it('carries the same catalogue-wide totals as the stock summary', async () => {
      const [reportResponse, stockResponse] = await Promise.all([
        as(adminToken, 'get', '/api/v1/reports/inventory').expect(200),
        as(adminToken, 'get', '/api/v1/stock/summary').expect(200),
      ]);

      const report = body<InventoryReportBody>(reportResponse);
      const stock = body<{ totalProducts: number }>(stockResponse);

      expect(report.totals.totalProducts).toBe(stock.totalProducts);
    });
  });

  describe('top-products', () => {
    it('ranks a fresh product by revenue inside a tightly bounded window', async () => {
      const from = new Date();

      const productId = await makeProduct('TOPPROD', '18.00', 20);
      await soldOrder(productId, 2, '36.00');

      const to = new Date(Date.now() + 1000);

      const response = await as(adminToken, 'get', `/api/v1/reports/top-products?from=${from.toISOString()}&to=${to.toISOString()}&limit=50`).expect(200);
      const products = body<TopProductBody[]>(response);

      const row = products.find((product) => product.productId === productId);
      expect(row).toBeDefined();
      expect(row?.quantitySold).toBe(2);
      expect(row?.revenue).toBe('36.00');
    });

    it('caps the result at the requested limit', async () => {
      const response = await as(adminToken, 'get', '/api/v1/reports/top-products?limit=1').expect(200);
      const products = body<TopProductBody[]>(response);

      expect(products.length).toBeLessThanOrEqual(1);
    });

    it('refuses a limit above the maximum', async () => {
      await as(adminToken, 'get', '/api/v1/reports/top-products?limit=500').expect(400);
    });
  });

  describe('analytics', () => {
    let technicianToken: string;
    let technicianId: string;
    let supplierId: string;

    beforeAll(async () => {
      const technician = await inviteTeammate(context, adminToken, 'rpt-tech', UserRole.TECHNICIAN);
      technicianToken = technician.accessToken;
      technicianId = technician.id;

      const supplierResponse = await request(context.server)
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ supplierCode: `${label}-SUP`, name: `${label} Supplier`, phone: '+1 555 0177' })
        .expect(201);
      supplierId = body<Identified>(supplierResponse).id;
    });

    async function analytics(query = ''): Promise<AdvancedAnalyticsBody> {
      const response = await as(adminToken, 'get', `/api/v1/reports/analytics${query}`).expect(200);
      return body<AdvancedAnalyticsBody>(response);
    }

    it('derives gross profit, margin and average order value from a tightly bounded window', async () => {
      const from = new Date();
      // makeProduct always sets costPrice 1.00; sellingPrice 25.00 -> selling 2 units nets revenue 50.00, cogs 2.00, grossProfit 48.00.
      const productId = await makeProduct('ANALYTICSGP', '25.00', 20);
      await soldOrder(productId, 2, '50.00');
      const to = new Date(Date.now() + 1000);

      const report = await analytics(`?from=${from.toISOString()}&to=${to.toISOString()}`);

      expect(report.sales.orderCount).toBe(1);
      expect(report.sales.revenue).toBe('50.00');
      expect(report.sales.grossProfit).toBe('48.00');
      expect(report.sales.margin).toBe('0.96');
      expect(report.sales.averageOrderValue).toBe('50.00');
    });

    it('counts a completed return against the orders in the same window', async () => {
      const from = new Date();
      const productId = await makeProduct('ANALYTICSRET', '30.00', 20);
      const order = await soldOrder(productId, 1, '30.00');

      const orderDetail = await as(adminToken, 'get', `/api/v1/orders/${order.id}`).expect(200);
      const itemId = (body<{ items: { id: string }[] }>(orderDetail).items[0] as { id: string }).id;

      const returnCreated = await as(adminToken, 'post', '/api/v1/returns')
        .send({ orderId: order.id, reason: 'CHANGED_MIND', items: [{ orderItemId: itemId, quantity: 1 }] })
        .expect(201);
      const returnId = body<Identified>(returnCreated).id;

      await as(adminToken, 'post', `/api/v1/returns/${returnId}/approve`).expect(200);
      await as(adminToken, 'post', `/api/v1/returns/${returnId}/complete`).send({ method: PaymentMethod.CASH }).expect(200);

      const to = new Date(Date.now() + 1000);
      const report = await analytics(`?from=${from.toISOString()}&to=${to.toISOString()}`);

      // 1 order, 1 completed return in the same window -> returnRate 1.
      expect(report.sales.returnRate).toBe('1.00');
    });

    it('reports a fully received purchase order against its supplier', async () => {
      const from = new Date();
      const productCreated = await as(adminToken, 'post', '/api/v1/products')
        .send({ sku: `${label}-ANALYTICSPO`, name: 'Report ANALYTICSPO', categoryId, costPrice: '1.00', sellingPrice: '10.00' })
        .expect(201);
      const productId = body<Identified>(productCreated).id;

      const poCreated = await as(adminToken, 'post', '/api/v1/purchase-orders')
        .send({ supplierId, items: [{ productId, quantity: 5, unitCost: '4.00' }] })
        .expect(201);
      const po = body<{ id: string; items: { id: string }[] }>(poCreated);

      await as(adminToken, 'post', `/api/v1/purchase-orders/${po.id}/approve`).expect(200);
      await as(adminToken, 'post', `/api/v1/purchase-orders/${po.id}/order`).expect(200);
      await as(adminToken, 'post', `/api/v1/purchase-orders/${po.id}/goods-receipts`)
        .send({ items: [{ purchaseOrderItemId: po.items[0]?.id, quantityReceived: 5 }] })
        .expect(201);

      const to = new Date(Date.now() + 1000);
      const report = await analytics(`?from=${from.toISOString()}&to=${to.toISOString()}`);

      const row = report.purchasing.suppliers.find((s) => s.supplierId === supplierId);
      expect(row).toBeDefined();
      expect(row?.orderCount).toBe(1);
      expect(row?.totalSpend).toBe('20.00');
      expect(row?.avgLeadTimeDays).not.toBeNull();
    });

    it('reports a completed repair against turnaround, completion rate and revenue', async () => {
      const from = new Date();

      const customer = await as(adminToken, 'post', '/api/v1/customers')
        .send({ customerCode: `${label}-RC1`, firstName: 'Analytics', lastName: 'Repair', phone: '+1 555 0188' })
        .expect(201);
      const repairCustomerId = body<Identified>(customer).id;

      const repairCreated = await as(adminToken, 'post', '/api/v1/repairs')
        .send({
          customerId: repairCustomerId,
          deviceType: 'PHONE',
          problemDescription: 'Cracked screen',
          technicianId,
        })
        .expect(201);
      const repairId = body<Identified>(repairCreated).id;

      async function moveTo(toStatus: RepairStatus): Promise<void> {
        await request(context.server)
          .post(`/api/v1/repairs/${repairId}/status`)
          .set('Authorization', `Bearer ${technicianToken}`)
          .send({ toStatus })
          .expect(200);
      }

      await moveTo(RepairStatus.DIAGNOSING);
      await moveTo(RepairStatus.APPROVED);
      await moveTo(RepairStatus.IN_PROGRESS);
      await as(adminToken, 'patch', `/api/v1/repairs/${repairId}`)
        .send({ finalCost: '75.00' })
        .expect(200);
      await moveTo(RepairStatus.COMPLETED);

      const to = new Date(Date.now() + 1000);
      const report = await analytics(`?from=${from.toISOString()}&to=${to.toISOString()}`);

      expect(report.repairs.completionRate).toBe('1.00');
      expect(report.repairs.repairRevenue).toBe('75.00');
      expect(report.repairs.avgTurnaroundDays).not.toBeNull();
    });

    it('counts a technician mid-repair as active workload', async () => {
      const customer = await as(adminToken, 'post', '/api/v1/customers')
        .send({ customerCode: `${label}-RC2`, firstName: 'Analytics', lastName: 'Workload', phone: '+1 555 0166' })
        .expect(201);
      const repairCustomerId = body<Identified>(customer).id;

      await as(adminToken, 'post', '/api/v1/repairs')
        .send({ customerId: repairCustomerId, deviceType: 'LAPTOP', problemDescription: 'Wont boot', technicianId })
        .expect(201);

      const report = await analytics();
      const row = report.repairs.technicianWorkload.find((t) => t.technicianId === technicianId);

      expect(row).toBeDefined();
      expect(row?.activeCount).toBeGreaterThanOrEqual(1);
    });

    it('counts an unsold, in-stock product as dead stock', async () => {
      await makeProduct('ANALYTICSDEAD', '15.00', 10);

      const report = await analytics();
      expect(report.inventory.deadStockCount).toBeGreaterThanOrEqual(1);
    });
  });
});
