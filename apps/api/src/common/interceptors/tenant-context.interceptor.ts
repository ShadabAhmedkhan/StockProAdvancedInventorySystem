import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { defer } from 'rxjs';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { enterTenantContext } from '../tenant/tenant-context';

/**
 * Establishes the AsyncLocalStorage tenant context for the rest of this
 * request's async chain.
 *
 * `JwtAuthGuard#canActivate` cannot do this itself: guards run to completion
 * before Nest ever calls the handler, so an `enterWith` there does not survive
 * into the controller/service call, which Nest invokes through its own
 * RxJS-based pipeline rather than as a direct continuation of the guard. An
 * interceptor's `next.handle()` is that continuation, so wrapping it in
 * `storage.run()`-equivalent scoping here is what actually reaches every
 * downstream service query.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const organizationId = request.user?.organizationId;

    if (organizationId === undefined) {
      // Public routes (login, register, health) have no authenticated user
      // and therefore no tenant to scope to - nothing to establish.
      return next.handle();
    }

    return defer(() => {
      enterTenantContext(organizationId);
      return next.handle();
    });
  }
}
