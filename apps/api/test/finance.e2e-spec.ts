import request from 'supertest';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import {
  DeviceType,
  ExpenseCategory,
  PaymentMethod,
  PaymentReferenceType,
  RepairStatus,
  ReturnReason,
  StockMovementType,
  TransactionReferenceType,
  TransactionType,
  UserRole,
} from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

interface Identified {
  id: string;
}

interface OrderBody {
  id: string;
  items: { id: string }[];
}

interface RepairBody {
  id: string;
  finalCost: string | null;
}

interface ExpenseBody {
  id: string;
  expenseNumber: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
  expenseDate: string;
  createdBy: { id: string };
}

interface PaymentBody {
  id: string;
  paymentNumber: string;
  amount: string;
  referenceType: PaymentReferenceType;
}

interface TransactionBody {
  id: string;
  type: TransactionType;
  amount: string;
  description: string;
  referenceType: TransactionReferenceType | null;
  referenceId: string | null;
}

interface SummaryBody {
  income: { sale: string; repairPayment: string; otherIncome: string; total: string };
  refunds: string;
  expenses: { byCategory: Record<ExpenseCategory, string>; total: string };
  netRevenue: string;
  netPosition: string;
}

function body<T>(response: { body: ApiResponse<T> }): T {
  return response.body.data;
}

function errorMessage(response: request.Response): string {
  return (response.body as ApiErrorResponse).message;
}

describe('Finance (e2e)', () => {
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

  async function makeProduct(suffix: string, sellingPrice: string, quantity: number): Promise<string> {
    const created = await as(adminToken, 'post', '/api/v1/products')
      .send({ sku: `${label}-${suffix}`, name: `Priced ${suffix}`, categoryId, costPrice: '1.00', sellingPrice })
      .expect(201);

    const productId = body<Identified>(created).id;

    await as(adminToken, 'post', '/api/v1/stock/adjust').send({ productId, type: StockMovementType.PURCHASE, quantity }).expect(200);

    return productId;
  }

  /** A completed, paid order - the source of a SALE ledger entry. */
  async function paidOrder(productId: string, quantity: number, amount: string): Promise<PaymentBody> {
    const created = await as(staffToken, 'post', '/api/v1/orders')
      .send({ customerId, items: [{ productId, quantity }] })
      .expect(201);
    const order = body<OrderBody>(created);

    await as(staffToken, 'post', `/api/v1/orders/${order.id}/confirm`).expect(200);
    const payment = await as(staffToken, 'post', `/api/v1/orders/${order.id}/payments`).send({ method: PaymentMethod.CASH, amount }).expect(201);
    await as(staffToken, 'post', `/api/v1/orders/${order.id}/complete`).expect(200);

    return body<PaymentBody>(payment);
  }

  /** A completed, priced, paid repair - the source of a REPAIR_PAYMENT ledger entry. */
  async function paidRepair(finalCost: string): Promise<PaymentBody> {
    const intake = await as(staffToken, 'post', '/api/v1/repairs')
      .send({ customerId, deviceType: DeviceType.PHONE, problemDescription: 'Battery will not hold a charge', technicianId })
      .expect(201);
    const repair = body<RepairBody>(intake);

    await as(technicianToken, 'post', `/api/v1/repairs/${repair.id}/status`).send({ toStatus: RepairStatus.DIAGNOSING }).expect(200);
    await as(technicianToken, 'post', `/api/v1/repairs/${repair.id}/status`).send({ toStatus: RepairStatus.APPROVED }).expect(200);
    await as(technicianToken, 'post', `/api/v1/repairs/${repair.id}/status`).send({ toStatus: RepairStatus.IN_PROGRESS }).expect(200);
    await as(technicianToken, 'patch', `/api/v1/repairs/${repair.id}`).send({ finalCost }).expect(200);
    await as(technicianToken, 'post', `/api/v1/repairs/${repair.id}/status`).send({ toStatus: RepairStatus.COMPLETED }).expect(200);

    const payment = await as(staffToken, 'post', `/api/v1/repairs/${repair.id}/payments`).send({ method: PaymentMethod.CARD, amount: finalCost }).expect(201);

    return body<PaymentBody>(payment);
  }

  beforeAll(async () => {
    context = await createTestApp({ throttleLimit: 5000 });
    label = `FN${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });

      await context.prisma.payment.deleteMany({ where: { createdById } });
      await context.prisma.financialTransaction.deleteMany({ where: { createdById } });
      await context.prisma.expense.deleteMany({ where: { createdById } });
      // ReturnItem cascades from Return.
      await context.prisma.return.deleteMany({ where: { createdById } });
      await context.prisma.repairStatusHistory.deleteMany({ where: { changedById: createdById } });
      await context.prisma.repair.deleteMany({ where: { customer: { customerCode: { startsWith: label } } } });
      await context.prisma.order.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.customer.deleteMany({ where: { customerCode: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'fin-admin', UserRole.ADMIN)).accessToken;
    managerToken = (await inviteTeammate(context, adminToken, 'fin-manager', UserRole.MANAGER)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'fin-staff', UserRole.STAFF)).accessToken;
    const technician = await inviteTeammate(context, adminToken, 'fin-tech', UserRole.TECHNICIAN);
    technicianToken = technician.accessToken;
    technicianId = technician.id;

    const category = await as(adminToken, 'post', '/api/v1/categories')
      .send({ name: `${label} Finance` })
      .expect(201);
    categoryId = body<Identified>(category).id;

    const customer = await as(adminToken, 'post', '/api/v1/customers')
      .send({ customerCode: `${label}-C1`, firstName: 'Finance', lastName: 'Customer', phone: '+1 555 0177' })
      .expect(201);
    customerId = body<Identified>(customer).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('expenses', () => {
    it('records an expense with a document number, as a manager', async () => {
      const response = await as(managerToken, 'post', '/api/v1/finance/expenses')
        .send({ category: ExpenseCategory.SUPPLIES, description: `${label} soldering flux`, amount: '18.50' })
        .expect(201);

      const expense = body<ExpenseBody>(response);
      expect(expense.expenseNumber).toMatch(/^EXP-\d{8}$/);
      expect(expense.amount).toBe('18.50');
    });

    it('refuses a staff member recording an expense', async () => {
      await as(staffToken, 'post', '/api/v1/finance/expenses')
        .send({ category: ExpenseCategory.SUPPLIES, description: 'Should be refused', amount: '5.00' })
        .expect(403);
    });

    it('writes a ledger entry alongside the expense', async () => {
      const created = await as(managerToken, 'post', '/api/v1/finance/expenses')
        .send({ category: ExpenseCategory.MAINTENANCE, description: `${label} bench servicing`, amount: '42.00' })
        .expect(201);
      const expense = body<ExpenseBody>(created);

      const ledger = await as(adminToken, 'get', `/api/v1/finance/transactions?search=${label}%20bench%20servicing`).expect(200);
      const [entry] = body<TransactionBody[]>(ledger);

      expect(entry).toBeDefined();
      expect(entry?.type).toBe(TransactionType.EXPENSE);
      expect(entry?.amount).toBe('42.00');
      expect(entry?.referenceType).toBe(TransactionReferenceType.EXPENSE);
      expect(entry?.referenceId).toBe(expense.id);
    });

    it('filters by category', async () => {
      await as(managerToken, 'post', '/api/v1/finance/expenses')
        .send({ category: ExpenseCategory.TRANSPORT, description: `${label} courier run`, amount: '12.00' })
        .expect(201);

      const response = await as(adminToken, 'get', `/api/v1/finance/expenses?category=${ExpenseCategory.TRANSPORT}&search=${label}`).expect(200);
      const rows = body<ExpenseBody[]>(response);

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.category === ExpenseCategory.TRANSPORT)).toBe(true);
    });

    it('keeps the ledger entry in step when the expense is corrected', async () => {
      const created = await as(managerToken, 'post', '/api/v1/finance/expenses')
        .send({ category: ExpenseCategory.OTHER, description: `${label} correction target`, amount: '10.00' })
        .expect(201);
      const expense = body<ExpenseBody>(created);

      await as(managerToken, 'patch', `/api/v1/finance/expenses/${expense.id}`).send({ amount: '15.00' }).expect(200);

      const ledger = await as(adminToken, 'get', `/api/v1/finance/transactions?search=${label}%20correction%20target`).expect(200);
      const [entry] = body<TransactionBody[]>(ledger);

      expect(entry?.amount).toBe('15.00');
    });

    it('refuses a staff member correcting an expense', async () => {
      const created = await as(managerToken, 'post', '/api/v1/finance/expenses')
        .send({ category: ExpenseCategory.OTHER, description: `${label} staff cannot touch`, amount: '10.00' })
        .expect(201);
      const expense = body<ExpenseBody>(created);

      await as(staffToken, 'patch', `/api/v1/finance/expenses/${expense.id}`).send({ amount: '99.00' }).expect(403);
    });

    it('removes the ledger entry along with the expense', async () => {
      const created = await as(managerToken, 'post', '/api/v1/finance/expenses')
        .send({ category: ExpenseCategory.OTHER, description: `${label} entered by mistake`, amount: '7.00' })
        .expect(201);
      const expense = body<ExpenseBody>(created);

      await as(managerToken, 'delete', `/api/v1/finance/expenses/${expense.id}`).expect(200);

      await as(adminToken, 'get', `/api/v1/finance/expenses/${expense.id}`).expect(404);

      const ledger = await as(adminToken, 'get', `/api/v1/finance/transactions?search=${label}%20entered%20by%20mistake`).expect(200);
      expect(body<TransactionBody[]>(ledger)).toHaveLength(0);
    });

    it('404s for an expense that does not exist', async () => {
      const response = await as(adminToken, 'get', '/api/v1/finance/expenses/00000000-0000-4000-8000-000000000000').expect(404);
      expect(errorMessage(response)).toMatch(/not found/i);
    });
  });

  describe('payments', () => {
    it('lists the payment recorded against a completed order', async () => {
      const productId = await makeProduct('SALE', '25.00', 20);
      const payment = await paidOrder(productId, 1, '25.00');

      const found = await as(adminToken, 'get', `/api/v1/finance/payments/${payment.id}`).expect(200);
      expect(body<PaymentBody>(found).referenceType).toBe(PaymentReferenceType.ORDER);
    });

    it('filters payments by reference type', async () => {
      const productId = await makeProduct('FILT', '30.00', 20);
      await paidOrder(productId, 1, '30.00');

      const response = await as(adminToken, 'get', `/api/v1/finance/payments?referenceType=${PaymentReferenceType.ORDER}&limit=100`).expect(200);
      const rows = body<PaymentBody[]>(response);

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.referenceType === PaymentReferenceType.ORDER)).toBe(true);
    });

    it('writes a SALE ledger entry for an order payment', async () => {
      const productId = await makeProduct('LEDGSALE', '40.00', 20);
      const payment = await paidOrder(productId, 1, '40.00');

      const ledger = await as(adminToken, 'get', `/api/v1/finance/transactions?search=${payment.paymentNumber}`).expect(200);
      const [entry] = body<TransactionBody[]>(ledger);

      expect(entry?.type).toBe(TransactionType.SALE);
      expect(entry?.amount).toBe('40.00');
      expect(entry?.referenceType).toBe(TransactionReferenceType.ORDER);
    });

    it('writes a REPAIR_PAYMENT ledger entry for a repair payment', async () => {
      const payment = await paidRepair('88.00');

      const ledger = await as(adminToken, 'get', `/api/v1/finance/transactions?search=${payment.paymentNumber}`).expect(200);
      const [entry] = body<TransactionBody[]>(ledger);

      expect(entry?.type).toBe(TransactionType.REPAIR_PAYMENT);
      expect(entry?.amount).toBe('88.00');
      expect(entry?.referenceType).toBe(TransactionReferenceType.REPAIR);
    });

    it('writes a REFUND ledger entry for a completed return', async () => {
      const productId = await makeProduct('LEDGREF', '20.00', 20);

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
      await as(adminToken, 'post', `/api/v1/returns/${returnId}/complete`).send({ method: PaymentMethod.CASH }).expect(200);

      const refund = await as(adminToken, 'get', `/api/v1/finance/payments?referenceType=${PaymentReferenceType.RETURN}&limit=100`).expect(200);
      const refundPayment = body<PaymentBody[]>(refund).find((row) => row.referenceType === PaymentReferenceType.RETURN);
      expect(refundPayment).toBeDefined();

      const ledger = await as(adminToken, 'get', `/api/v1/finance/transactions?search=${refundPayment?.paymentNumber ?? ''}`).expect(200);
      const [entry] = body<TransactionBody[]>(ledger);

      expect(entry?.type).toBe(TransactionType.REFUND);
      expect(entry?.amount).toBe('20.00');
      expect(entry?.referenceType).toBe(TransactionReferenceType.RETURN);
    });
  });

  describe('other income', () => {
    it('records a manual ledger entry with no reference, as a manager', async () => {
      const response = await as(managerToken, 'post', '/api/v1/finance/transactions')
        .send({ amount: '33.00', description: `${label} scrap metal sale` })
        .expect(201);

      const entry = body<TransactionBody>(response);
      expect(entry.type).toBe(TransactionType.OTHER_INCOME);
      expect(entry.referenceType).toBeNull();
      expect(entry.referenceId).toBeNull();
    });

    it('refuses a staff member recording other income', async () => {
      await as(staffToken, 'post', '/api/v1/finance/transactions').send({ amount: '5.00', description: 'Should be refused' }).expect(403);
    });
  });

  describe('summary', () => {
    it('reflects an expense, a sale, a repair payment and other income within the window', async () => {
      const from = new Date();

      const productId = await makeProduct('SUMSALE', '60.00', 20);
      await paidOrder(productId, 1, '60.00');
      await paidRepair('45.00');
      await as(managerToken, 'post', '/api/v1/finance/expenses')
        .send({ category: ExpenseCategory.SUPPLIES, description: `${label} summary expense`, amount: '10.00' })
        .expect(201);
      await as(managerToken, 'post', '/api/v1/finance/transactions')
        .send({ amount: '5.00', description: `${label} summary income` })
        .expect(201);

      const to = new Date(Date.now() + 1000);

      const response = await as(adminToken, 'get', `/api/v1/finance/summary?from=${from.toISOString()}&to=${to.toISOString()}`).expect(200);
      const summary = body<SummaryBody>(response);

      expect(summary.income.sale).toBe('60.00');
      expect(summary.income.repairPayment).toBe('45.00');
      expect(summary.income.otherIncome).toBe('5.00');
      expect(summary.income.total).toBe('110.00');
      expect(summary.expenses.total).toBe('10.00');
      expect(summary.netRevenue).toBe('110.00');
      expect(summary.netPosition).toBe('100.00');
    });

    it('excludes activity outside the requested window', async () => {
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const response = await as(adminToken, 'get', `/api/v1/finance/summary?from=${farFuture.toISOString()}`).expect(200);
      const summary = body<SummaryBody>(response);

      expect(summary.income.total).toBe('0.00');
      expect(summary.expenses.total).toBe('0.00');
    });
  });
});
