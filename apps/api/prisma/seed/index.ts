import { seedCatalog } from './catalog.seed';
import { prisma } from './client';
import { seedCustomers, seedSuppliers } from './parties.seed';
import { seedOperations } from './operations.seed';
import { SEED_PASSWORD, seedUsers } from './users.seed';

/**
 * Development seed.
 *
 * Re-runnable: every record is keyed on a natural identifier and either
 * upserted or skipped when already present, so running it twice does not
 * duplicate orders or inflate stock. It is not a fixture reset - use
 * `pnpm db:reset` followed by a migrate and seed for a clean slate.
 */
async function main(): Promise<void> {
  const started = Date.now();

  const users = await seedUsers();
  const customers = await seedCustomers();
  const supplierCount = await seedSuppliers();
  const catalog = await seedCatalog(users.admin.id);
  const operations = await seedOperations(users, customers, catalog);

  const inventoryUnits = await prisma.inventory.aggregate({ _sum: { quantity: true } });
  const movementCount = await prisma.stockMovement.count();

  const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(1);

  process.stdout.write(
    [
      '',
      `Seed complete in ${elapsedSeconds}s`,
      '',
      `  users            5 (1 admin, 1 manager, 2 staff, 1 technician)`,
      `  customers        ${String(customers.all.length)}`,
      `  suppliers        ${String(supplierCount)}`,
      `  categories       ${String(catalog.categoryCount)}`,
      `  brands           ${String(catalog.brandCount)}`,
      `  products         ${String(catalog.productCount)}`,
      `  inventory units  ${String(inventoryUnits._sum.quantity ?? 0)}`,
      `  stock movements  ${String(movementCount)}`,
      `  orders           ${String(operations.orderCount)}`,
      `  repairs          ${String(operations.repairCount)}`,
      `  expenses         ${String(operations.expenseCount)}`,
      '',
      '  Development sign-in (local only):',
      `    admin@stockpro.test / ${SEED_PASSWORD}`,
      '',
    ].join('\n'),
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    process.exitCode = 1;
    process.stderr.write(`\nSeed failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    if (error instanceof Error && error.stack !== undefined) {
      process.stderr.write(`${error.stack}\n`);
    }
    await prisma.$disconnect();
  });
