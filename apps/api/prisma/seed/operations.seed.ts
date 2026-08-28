import {
  DeviceType,
  ExpenseCategory,
  OrderStatus,
  PaymentMethod,
  PaymentReferenceType,
  PaymentStatus,
  RepairStatus,
  StockMovementType,
  StockReferenceType,
  TransactionReferenceType,
  TransactionType,
} from '../../src/generated/prisma/enums';
import type { SeededCatalog, SeededProductRecord } from './catalog.seed';
import { DOCUMENT_SEQUENCES } from '../../src/common/documents/document-number';
import { daysAgo, prisma } from './client';
import type { SeededCustomers } from './parties.seed';
import type { SeededUsers } from './users.seed';

/** Sales tax applied to seeded orders, as a percentage of the discounted subtotal. */
const TAX_RATE_PERCENT = 8;

interface SeededOrderLine {
  sku: string;
  quantity: number;
  /** Per-line discount in currency units, not a percentage. */
  discount?: number;
}

interface SeededOrder {
  orderNumber: string;
  customerCode: string | null;
  daysAgo: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  /** Fraction of the total actually collected. 1 means paid in full. */
  paidFraction: number;
  lines: SeededOrderLine[];
}

const ORDERS: SeededOrder[] = [
  {
    orderNumber: 'ORD-00000001',
    customerCode: 'CUS-0001',
    daysAgo: 26,
    status: OrderStatus.COMPLETED,
    paymentStatus: PaymentStatus.PAID,
    paymentMethod: PaymentMethod.CARD,
    paidFraction: 1,
    lines: [
      { sku: 'SPH-AUR-A12', quantity: 1, discount: 20 },
      { sku: 'ACC-CSE-AUR12', quantity: 1 },
      { sku: 'ACC-GLS-UNIV', quantity: 2 },
    ],
  },
  {
    orderNumber: 'ORD-00000002',
    customerCode: 'CUS-0002',
    daysAgo: 19,
    status: OrderStatus.COMPLETED,
    paymentStatus: PaymentStatus.PAID,
    paymentMethod: PaymentMethod.CASH,
    paidFraction: 1,
    lines: [
      { sku: 'SPH-NIM-N7', quantity: 2 },
      { sku: 'ACC-CBL-USBC2M', quantity: 2 },
    ],
  },
  {
    orderNumber: 'ORD-00000003',
    customerCode: 'CUS-0003',
    daysAgo: 12,
    status: OrderStatus.COMPLETED,
    paymentStatus: PaymentStatus.PAID,
    paymentMethod: PaymentMethod.BANK_TRANSFER,
    paidFraction: 1,
    lines: [
      { sku: 'LAP-COR-BK14', quantity: 1, discount: 50 },
      { sku: 'ACC-PWR-65W', quantity: 1 },
    ],
  },
  {
    orderNumber: 'ORD-00000004',
    customerCode: null,
    daysAgo: 5,
    status: OrderStatus.COMPLETED,
    paymentStatus: PaymentStatus.PAID,
    paymentMethod: PaymentMethod.CASH,
    paidFraction: 1,
    lines: [
      { sku: 'ACC-AUD-BUDS', quantity: 1 },
      { sku: 'ACC-PWB-10K', quantity: 1 },
    ],
  },
  {
    orderNumber: 'ORD-00000005',
    customerCode: 'CUS-0006',
    daysAgo: 2,
    status: OrderStatus.CONFIRMED,
    paymentStatus: PaymentStatus.PARTIAL,
    paymentMethod: PaymentMethod.CARD,
    paidFraction: 0.5,
    lines: [{ sku: 'TAB-HAL-T10', quantity: 1 }],
  },
  {
    orderNumber: 'ORD-00000006',
    customerCode: 'CUS-0007',
    daysAgo: 0,
    status: OrderStatus.DRAFT,
    paymentStatus: PaymentStatus.UNPAID,
    paymentMethod: PaymentMethod.CASH,
    paidFraction: 0,
    lines: [{ sku: 'SPH-AUR-A12P', quantity: 1 }],
  },
];

interface SeededRepair {
  repairNumber: string;
  customerCode: string;
  deviceType: DeviceType;
  brand: string;
  model: string;
  imei: string | null;
  serialNumber: string | null;
  problemDescription: string;
  diagnosis: string | null;
  estimatedCost: string | null;
  finalCost: string | null;
  status: RepairStatus;
  daysAgo: number;
  /** Statuses the repair passed through, in order, ending at `status`. */
  history: RepairStatus[];
}

const REPAIRS: SeededRepair[] = [
  {
    repairNumber: 'REP-00000001',
    customerCode: 'CUS-0002',
    deviceType: DeviceType.PHONE,
    brand: 'Aureon',
    model: 'A12',
    imei: '356938035643809',
    serialNumber: null,
    problemDescription: 'Screen cracked after a drop; touch works intermittently.',
    diagnosis: 'Digitiser and OLED panel both damaged. Replacement required.',
    estimatedCost: '149.00',
    finalCost: '149.00',
    status: RepairStatus.DELIVERED,
    daysAgo: 21,
    history: [
      RepairStatus.RECEIVED,
      RepairStatus.DIAGNOSING,
      RepairStatus.WAITING_APPROVAL,
      RepairStatus.APPROVED,
      RepairStatus.IN_PROGRESS,
      RepairStatus.COMPLETED,
      RepairStatus.DELIVERED,
    ],
  },
  {
    repairNumber: 'REP-00000002',
    customerCode: 'CUS-0004',
    deviceType: DeviceType.PHONE,
    brand: 'Nimbus',
    model: 'N7',
    imei: '356938035643810',
    serialNumber: null,
    problemDescription: 'Battery drains within three hours of a full charge.',
    diagnosis: 'Battery health at 61%. Replacement recommended.',
    estimatedCost: '45.00',
    finalCost: null,
    status: RepairStatus.WAITING_PARTS,
    daysAgo: 6,
    history: [RepairStatus.RECEIVED, RepairStatus.DIAGNOSING, RepairStatus.WAITING_APPROVAL, RepairStatus.APPROVED, RepairStatus.WAITING_PARTS],
  },
  {
    repairNumber: 'REP-00000003',
    customerCode: 'CUS-0005',
    deviceType: DeviceType.LAPTOP,
    brand: 'Corvid',
    model: 'Book 14',
    imei: null,
    serialNumber: 'CB14-2291-8837',
    problemDescription: 'Does not charge; charging port feels loose.',
    diagnosis: null,
    estimatedCost: null,
    finalCost: null,
    status: RepairStatus.DIAGNOSING,
    daysAgo: 3,
    history: [RepairStatus.RECEIVED, RepairStatus.DIAGNOSING],
  },
  {
    repairNumber: 'REP-00000004',
    customerCode: 'CUS-0008',
    deviceType: DeviceType.TABLET,
    brand: 'Halcyon',
    model: 'Tab 10',
    imei: null,
    serialNumber: 'HT10-5540-1102',
    problemDescription: 'Will not power on after a firmware update.',
    diagnosis: null,
    estimatedCost: null,
    finalCost: null,
    status: RepairStatus.RECEIVED,
    daysAgo: 1,
    history: [RepairStatus.RECEIVED],
  },
];

interface SeededExpense {
  expenseNumber: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
  daysAgo: number;
}

const EXPENSES: SeededExpense[] = [
  { expenseNumber: 'EXP-00000001', category: ExpenseCategory.RENT, description: 'Shop rent - current month', amount: '2400.00', daysAgo: 28 },
  { expenseNumber: 'EXP-00000002', category: ExpenseCategory.UTILITIES, description: 'Electricity and water', amount: '318.45', daysAgo: 27 },
  { expenseNumber: 'EXP-00000003', category: ExpenseCategory.SALARIES, description: 'Staff salaries - current month', amount: '5200.00', daysAgo: 25 },
  { expenseNumber: 'EXP-00000004', category: ExpenseCategory.SUPPLIES, description: 'Workshop consumables and adhesives', amount: '162.90', daysAgo: 18 },
  { expenseNumber: 'EXP-00000005', category: ExpenseCategory.MARKETING, description: 'Local listing and print flyers', amount: '240.00', daysAgo: 14 },
  { expenseNumber: 'EXP-00000006', category: ExpenseCategory.MAINTENANCE, description: 'Soldering station servicing', amount: '95.00', daysAgo: 9 },
  { expenseNumber: 'EXP-00000007', category: ExpenseCategory.TRANSPORT, description: 'Courier for supplier returns', amount: '48.60', daysAgo: 4 },
  { expenseNumber: 'EXP-00000008', category: ExpenseCategory.OTHER, description: 'Point-of-sale software subscription', amount: '79.00', daysAgo: 1 },
];

/** Rounds to two decimals using integer cents, never floating-point currency. */
function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function lineTotal(product: SeededProductRecord, quantity: number, discount: number): number {
  return Number(product.sellingPrice) * quantity - discount;
}

export interface SeededOperations {
  orderCount: number;
  repairCount: number;
  expenseCount: number;
}

export async function seedOperations(
  organizationId: string,
  users: SeededUsers,
  customers: SeededCustomers,
  catalog: SeededCatalog,
  locationId: string,
): Promise<SeededOperations> {
  await seedOrders(organizationId, users, customers, catalog, locationId);
  await seedRepairs(organizationId, users, customers);
  await seedExpenses(organizationId, users);
  await advanceDocumentSequences();

  return { orderCount: ORDERS.length, repairCount: REPAIRS.length, expenseCount: EXPENSES.length };
}

/**
 * Writes each order with its items, and for COMPLETED orders also deducts
 * stock, records the SALE movements, the payment and the ledger entry - the
 * same set of writes the order-completion endpoint will perform.
 */
async function seedOrders(
  organizationId: string,
  users: SeededUsers,
  customers: SeededCustomers,
  catalog: SeededCatalog,
  locationId: string,
): Promise<void> {
  const cashier = users.staff[0] ?? users.admin;

  for (const definition of ORDERS) {
    const existing = await prisma.order.findUnique({
      where: { organizationId_orderNumber: { organizationId, orderNumber: definition.orderNumber } },
      select: { id: true },
    });
    if (existing !== null) {
      continue;
    }

    const placedAt = daysAgo(definition.daysAgo, 14);
    const customerId = definition.customerCode === null ? null : (customers.byCode.get(definition.customerCode)?.id ?? null);

    const lines = definition.lines.map((line) => {
      const product = catalog.products.get(line.sku);
      if (product === undefined) {
        throw new Error(`Order ${definition.orderNumber} references unknown SKU ${line.sku}`);
      }
      const discount = line.discount ?? 0;
      return { product, quantity: line.quantity, discount, total: lineTotal(product, line.quantity, discount) };
    });

    const subtotal = lines.reduce((sum, line) => sum + Number(line.product.sellingPrice) * line.quantity, 0);
    const discount = lines.reduce((sum, line) => sum + line.discount, 0);
    const tax = ((subtotal - discount) * TAX_RATE_PERCENT) / 100;
    const total = subtotal - discount + tax;
    const paidAmount = total * definition.paidFraction;
    const isCompleted = definition.status === OrderStatus.COMPLETED;

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          organizationId,
          orderNumber: definition.orderNumber,
          customerId,
          status: definition.status,
          subtotal: money(subtotal),
          discount: money(discount),
          tax: money(tax),
          total: money(total),
          paidAmount: money(paidAmount),
          paymentStatus: definition.paymentStatus,
          createdById: cashier.id,
          completedAt: isCompleted ? placedAt : null,
          createdAt: placedAt,
          items: {
            create: lines.map((line) => ({
              productId: line.product.id,
              quantity: line.quantity,
              unitPrice: line.product.sellingPrice,
              discount: money(line.discount),
              total: money(line.total),
              createdAt: placedAt,
            })),
          },
        },
        select: { id: true },
      });

      if (isCompleted) {
        for (const line of lines) {
          const inventory = await tx.inventory.update({
            where: { productId_locationId: { productId: line.product.id, locationId } },
            data: { quantity: { decrement: line.quantity } },
            select: { quantity: true },
          });

          await tx.stockMovement.create({
            data: {
              organizationId,
              productId: line.product.id,
              locationId,
              type: StockMovementType.SALE,
              quantity: line.quantity,
              previousQuantity: inventory.quantity + line.quantity,
              newQuantity: inventory.quantity,
              referenceType: StockReferenceType.ORDER,
              referenceId: order.id,
              note: `Sold on ${definition.orderNumber}`,
              createdById: cashier.id,
              createdAt: placedAt,
            },
          });
        }
      }

      if (paidAmount > 0) {
        await tx.payment.create({
          data: {
            organizationId,
            paymentNumber: `PAY-${definition.orderNumber.slice(-8)}`,
            method: definition.paymentMethod,
            amount: money(paidAmount),
            referenceType: PaymentReferenceType.ORDER,
            orderId: order.id,
            paidAt: placedAt,
            createdById: cashier.id,
            createdAt: placedAt,
          },
        });

        await tx.financialTransaction.create({
          data: {
            organizationId,
            type: TransactionType.SALE,
            amount: money(paidAmount),
            description: `Sale ${definition.orderNumber}`,
            occurredAt: placedAt,
            referenceType: TransactionReferenceType.ORDER,
            referenceId: order.id,
            createdById: cashier.id,
            createdAt: placedAt,
          },
        });
      }
    });
  }
}

async function seedRepairs(organizationId: string, users: SeededUsers, customers: SeededCustomers): Promise<void> {
  for (const definition of REPAIRS) {
    const existing = await prisma.repair.findUnique({
      where: { organizationId_repairNumber: { organizationId, repairNumber: definition.repairNumber } },
      select: { id: true },
    });
    if (existing !== null) {
      continue;
    }

    const customer = customers.byCode.get(definition.customerCode);
    if (customer === undefined) {
      throw new Error(`Repair ${definition.repairNumber} references unknown customer ${definition.customerCode}`);
    }

    const receivedAt = daysAgo(definition.daysAgo, 10);
    const isFinished = definition.status === RepairStatus.COMPLETED || definition.status === RepairStatus.DELIVERED;

    await prisma.$transaction(async (tx) => {
      const repair = await tx.repair.create({
        data: {
          organizationId,
          repairNumber: definition.repairNumber,
          customerId: customer.id,
          deviceType: definition.deviceType,
          brand: definition.brand,
          model: definition.model,
          imei: definition.imei,
          serialNumber: definition.serialNumber,
          problemDescription: definition.problemDescription,
          diagnosis: definition.diagnosis,
          estimatedCost: definition.estimatedCost,
          finalCost: definition.finalCost,
          technicianId: users.technician.id,
          status: definition.status,
          receivedAt,
          completedAt: isFinished ? daysAgo(Math.max(definition.daysAgo - 4, 0), 16) : null,
          createdAt: receivedAt,
        },
        select: { id: true },
      });

      // One history row per transition, each a day apart, ending at the current status.
      let previous: RepairStatus | null = null;
      for (const [index, status] of definition.history.entries()) {
        await tx.repairStatusHistory.create({
          data: {
            repairId: repair.id,
            fromStatus: previous,
            toStatus: status,
            changedById: index === 0 ? (users.staff[0]?.id ?? users.admin.id) : users.technician.id,
            createdAt: daysAgo(Math.max(definition.daysAgo - index, 0), 11),
          },
        });
        previous = status;
      }
    });
  }
}

async function seedExpenses(organizationId: string, users: SeededUsers): Promise<void> {
  for (const definition of EXPENSES) {
    const existing = await prisma.expense.findUnique({
      where: { organizationId_expenseNumber: { organizationId, expenseNumber: definition.expenseNumber } },
      select: { id: true },
    });
    if (existing !== null) {
      continue;
    }

    const incurredAt = daysAgo(definition.daysAgo, 9);

    await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          organizationId,
          expenseNumber: definition.expenseNumber,
          category: definition.category,
          description: definition.description,
          amount: definition.amount,
          expenseDate: incurredAt,
          createdById: users.manager.id,
          createdAt: incurredAt,
        },
        select: { id: true },
      });

      await tx.financialTransaction.create({
        data: {
          organizationId,
          type: TransactionType.EXPENSE,
          amount: definition.amount,
          description: definition.description,
          occurredAt: incurredAt,
          referenceType: TransactionReferenceType.EXPENSE,
          referenceId: expense.id,
          createdById: users.manager.id,
          createdAt: incurredAt,
        },
      });
    });
  }
}

/**
 * Moves the document sequences past the numbers this seed wrote by hand.
 *
 * Seeded orders carry fixed numbers so the seed can be re-run without
 * duplicating them, which means the sequences know nothing about them. Without
 * this the first real sale would be issued a number already sitting on a
 * seeded receipt.
 *
 * `GREATEST` keeps it idempotent and never winds a sequence backwards, which
 * matters when the seed is re-run against a database that has since traded.
 */
async function advanceDocumentSequences(): Promise<void> {
  // Payments are numbered from the order they settle, so they reach as high as
  // the orders do.
  const highestOrder = Math.max(...ORDERS.map((order) => documentSerial(order.orderNumber)));
  const highestRepair = Math.max(...REPAIRS.map((repair) => documentSerial(repair.repairNumber)));
  const highestExpense = Math.max(...EXPENSES.map((expense) => documentSerial(expense.expenseNumber)));

  const reached: [sequence: string, highest: number][] = [
    [DOCUMENT_SEQUENCES.ORDER.sequence, highestOrder],
    [DOCUMENT_SEQUENCES.PAYMENT.sequence, highestOrder],
    [DOCUMENT_SEQUENCES.REPAIR.sequence, highestRepair],
    [DOCUMENT_SEQUENCES.EXPENSE.sequence, highestExpense],
  ];

  for (const [sequence, highest] of reached) {
    await prisma.$executeRaw`
      SELECT setval(
        ${sequence}::regclass,
        GREATEST(
          COALESCE((SELECT last_value FROM pg_sequences WHERE schemaname = current_schema() AND sequencename = ${sequence}), 0),
          ${highest}
        )
      )
    `;
  }
}

/** The numeric tail of a document number: `ORD-00000006` is the sixth order. */
function documentSerial(documentNumber: string): number {
  return Number.parseInt(documentNumber.slice(documentNumber.indexOf('-') + 1), 10);
}
