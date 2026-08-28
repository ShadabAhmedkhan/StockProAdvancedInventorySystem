import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { databaseConfig } from '../src/config/database.config';
import { validateEnv } from '../src/config/env.validation';
import { StockMovementType } from '../src/generated/prisma/enums';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Runs against the real PostgreSQL from infrastructure/docker-compose.yml.
 * These invariants are enforced by the database itself, so mocking would
 * verify nothing: `pnpm db:up && pnpm prisma:migrate && pnpm db:seed` first.
 */
describe('Database schema (integration)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: ['.env', '../../.env'], load: [databaseConfig], validate: validateEnv }),
        PrismaModule,
      ],
    }).compile();

    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('connectivity', () => {
    it('connects and answers a query', async () => {
      const result = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;

      expect(result[0]?.ok).toBe(1);
    });

    it('has applied the initial migration', async () => {
      const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
      `;

      expect(applied.map((row) => row.migration_name)).toEqual(expect.arrayContaining([expect.stringContaining('init') as string]));
    });
  });

  describe('seed data', () => {
    // Scoped to the seed's own known accounts rather than a global count:
    // every other e2e suite creates its own organizations and users against
    // this same database, so a whole-table role count is only deterministic
    // when this file runs alone, not as part of the full suite.
    it('created the documented user roles', async () => {
      const users = await prisma.user.findMany({
        where: {
          email: {
            in: ['admin@stockpro.test', 'manager@stockpro.test', 'staff1@stockpro.test', 'staff2@stockpro.test', 'tech@stockpro.test'],
          },
        },
        select: { email: true, role: true },
      });
      const roleByEmail = new Map(users.map((row) => [row.email, row.role]));

      expect(roleByEmail.get('admin@stockpro.test')).toBe('ADMIN');
      expect(roleByEmail.get('manager@stockpro.test')).toBe('MANAGER');
      expect(roleByEmail.get('staff1@stockpro.test')).toBe('STAFF');
      expect(roleByEmail.get('staff2@stockpro.test')).toBe('STAFF');
      expect(roleByEmail.get('tech@stockpro.test')).toBe('TECHNICIAN');
    });

    it('never stores a plaintext password', async () => {
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@stockpro.test' }, select: { passwordHash: true } });

      expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
      expect(admin.passwordHash).not.toContain('Password123!');
    });

    it('gives every product an inventory row', async () => {
      const products = await prisma.product.count();
      const inventories = await prisma.inventory.count();

      expect(products).toBeGreaterThan(0);
      expect(inventories).toBe(products);
    });

    it('can explain every unit on hand from the movement ledger', async () => {
      // Scoped to the seed's own organization: every other e2e suite writes
      // its own inventory and movements against this same database, and a
      // suite that is mid-adjustment when this one happens to run concurrently
      // would otherwise be caught with a movement written but its inventory
      // update not yet committed (or vice versa).
      const seedAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@stockpro.test' }, select: { organizationId: true } });
      const inventories = await prisma.inventory.findMany({ where: { organizationId: seedAdmin.organizationId }, select: { productId: true, quantity: true } });
      const movements = await prisma.stockMovement.findMany({ where: { organizationId: seedAdmin.organizationId }, select: { productId: true, type: true, quantity: true } });

      const inbound = new Set<StockMovementType>([
        StockMovementType.PURCHASE,
        StockMovementType.RETURN_IN,
        StockMovementType.ADJUSTMENT_IN,
        StockMovementType.REPAIR_IN,
      ]);

      const ledger = new Map<string, number>();
      for (const movement of movements) {
        const signed = inbound.has(movement.type) ? movement.quantity : -movement.quantity;
        ledger.set(movement.productId, (ledger.get(movement.productId) ?? 0) + signed);
      }

      for (const inventory of inventories) {
        expect(ledger.get(inventory.productId) ?? 0).toBe(inventory.quantity);
      }
    });

    it('leaves completed orders fully paid and stamped with a completion time', async () => {
      // Scoped to the seed's own six orders (ORD-00000001..6 - see
      // prisma/seed/operations.seed.ts's ORDERS list): this suite runs
      // against a database that accumulates data across repeated local runs.
      // Playwright's own orders spec signs in as the seeded admin/staff
      // accounts and completes a real sale with no payment step (completion
      // does not require full payment - that's the app's real, intended
      // behaviour, not a bug), which would otherwise land inside this same
      // organization and falsely fail an invariant that only ever held for
      // the seed's own hand-picked orders.
      const seedAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@stockpro.test' }, select: { organizationId: true } });
      const completed = await prisma.order.findMany({
        where: { status: 'COMPLETED', organizationId: seedAdmin.organizationId, orderNumber: { lte: 'ORD-00000006' } },
        select: { orderNumber: true, total: true, paidAmount: true, completedAt: true },
      });

      expect(completed.length).toBeGreaterThan(0);
      for (const order of completed) {
        expect(order.completedAt).not.toBeNull();
        expect(order.paidAmount.equals(order.total)).toBe(true);
      }
    });

    it('records a status history row for every repair', async () => {
      const repairs = await prisma.repair.findMany({
        select: { id: true, status: true, statusHistory: { select: { toStatus: true }, orderBy: { createdAt: 'asc' } } },
      });

      expect(repairs.length).toBeGreaterThan(0);
      for (const repair of repairs) {
        expect(repair.statusHistory.length).toBeGreaterThan(0);
        expect(repair.statusHistory[0]?.toStatus).toBe('RECEIVED');
        expect(repair.statusHistory.at(-1)?.toStatus).toBe(repair.status);
      }
    });
  });

  describe('database-enforced invariants', () => {
    it('rejects negative stock', async () => {
      const inventory = await prisma.inventory.findFirstOrThrow({ select: { id: true, quantity: true } });

      await expect(prisma.inventory.update({ where: { id: inventory.id }, data: { quantity: -1 } })).rejects.toThrow(/Inventory_quantity_non_negative/);
    });

    it('rejects reserving more stock than is on hand', async () => {
      const inventory = await prisma.inventory.findFirstOrThrow({ where: { quantity: { gt: 0 } }, select: { id: true, quantity: true } });

      await expect(prisma.inventory.update({ where: { id: inventory.id }, data: { reservedQuantity: inventory.quantity + 1 } })).rejects.toThrow(
        /Inventory_reserved_within_quantity/,
      );
    });

    it('rejects a zero-quantity order line', async () => {
      const item = await prisma.orderItem.findFirstOrThrow({ select: { id: true } });

      await expect(prisma.orderItem.update({ where: { id: item.id }, data: { quantity: 0 } })).rejects.toThrow(/OrderItem_quantity_positive/);
    });

    it('rejects a payment whose subject does not match its reference type', async () => {
      const payment = await prisma.payment.findFirstOrThrow({ where: { referenceType: 'ORDER' }, select: { id: true } });

      await expect(prisma.payment.update({ where: { id: payment.id }, data: { referenceType: 'REPAIR' } })).rejects.toThrow(/Payment_reference_matches_type/);
    });

    it('refuses to drop a category that still has products', async () => {
      const category = await prisma.category.findFirstOrThrow({ where: { products: { some: {} } }, select: { id: true } });

      await expect(prisma.category.delete({ where: { id: category.id } })).rejects.toThrow();
    });

    it('rejects a duplicate SKU', async () => {
      const existing = await prisma.product.findFirstOrThrow({ select: { sku: true, categoryId: true, organizationId: true } });

      await expect(
        prisma.product.create({
          data: {
            sku: existing.sku,
            name: 'Duplicate SKU probe',
            categoryId: existing.categoryId,
            organizationId: existing.organizationId,
            costPrice: '1.00',
            sellingPrice: '2.00',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('money handling', () => {
    it('stores monetary values as exact decimals', async () => {
      const product = await prisma.product.findFirstOrThrow({ where: { sku: 'ACC-GLS-UNIV' }, select: { costPrice: true, sellingPrice: true } });

      // 1.05 has no exact binary representation; Decimal must round-trip it.
      expect(product.costPrice.toFixed(2)).toBe('1.05');
      expect(product.sellingPrice.toFixed(2)).toBe('7.50');
      expect(product.sellingPrice.minus(product.costPrice).toFixed(2)).toBe('6.45');
    });

    it('keeps order totals internally consistent', async () => {
      const orders = await prisma.order.findMany({ select: { orderNumber: true, subtotal: true, discount: true, tax: true, total: true } });

      expect(orders.length).toBeGreaterThan(0);
      for (const order of orders) {
        const expected = order.subtotal.minus(order.discount).plus(order.tax);
        expect(order.total.toFixed(2)).toBe(expected.toFixed(2));
      }
    });
  });
});
