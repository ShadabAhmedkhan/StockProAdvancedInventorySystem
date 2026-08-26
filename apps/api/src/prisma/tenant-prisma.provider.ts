import type { Provider } from '@nestjs/common';
import { tenantExtension } from './tenant.extension';
import { PrismaService } from './prisma.service';

/** DI token for the tenant-scoped Prisma client. Every service that queries a
 * `TENANT_MODELS` model (see `tenant.extension.ts`) injects this instead of the
 * raw `PrismaService` - everything else (health checks, the seed script) keeps
 * using `PrismaService` directly. */
export const TENANT_PRISMA = Symbol('TENANT_PRISMA');

function extend(prisma: PrismaService) {
  return prisma.$extends(tenantExtension);
}

/** The type every tenant-scoped service should annotate its injected client as. */
export type TenantPrismaClient = ReturnType<typeof extend>;

// Only ever used as `typeof getTransactionClient` below, to extract the `tx` parameter type -
// never called directly, which trips the unused-vars rule without this disable.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getTransactionClient(client: TenantPrismaClient) {
  return client.$transaction((tx) => Promise.resolve(tx));
}

/** The `tx` parameter type inside `tenantPrisma.$transaction(async (tx) => ...)`. Every
 * helper a tenant-scoped service passes its `tx` into (instead of `Prisma.TransactionClient`,
 * which the extended transaction client isn't structurally assignable to) should use this. */
export type TenantTransactionClient = Awaited<ReturnType<typeof getTransactionClient>>;

export const tenantPrismaProvider: Provider = {
  provide: TENANT_PRISMA,
  useFactory: extend,
  inject: [PrismaService],
};
