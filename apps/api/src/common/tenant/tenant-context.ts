import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantContext {
  organizationId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Puts `organizationId` into the current async execution context. Called once,
 * synchronously, from `TenantContextInterceptor` right before it invokes
 * `next.handle()` - that call is what actually continues into the controller
 * and service layer, which is why this lives in an interceptor rather than
 * `JwtAuthGuard` (a guard completing does not hand off to the handler as a
 * direct async continuation, so an `enterWith` there does not survive).
 */
export function enterTenantContext(organizationId: string): void {
  storage.enterWith({ organizationId });
}

/**
 * The current request's organization id. Throws rather than returning
 * `undefined` - a tenant-scoped Prisma query with no organization id to filter
 * by must fail loudly, never silently run unscoped.
 */
export function getCurrentOrgId(): string {
  const context = storage.getStore();
  if (context === undefined) {
    throw new Error('getCurrentOrgId() called outside a request with an established tenant context');
  }
  return context.organizationId;
}
