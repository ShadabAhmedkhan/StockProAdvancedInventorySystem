import type { AuthenticatedPlatformAdmin } from '../common/interfaces/authenticated-platform-admin.interface';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

declare global {
  namespace Express {
    interface Request {
      /**
       * Correlation id for this request. Assigned by `requestIdMiddleware`,
       * which is the first middleware registered on the Express instance, so
       * it is present for the whole lifetime of every request.
       */
      requestId: string;

      /**
       * The authenticated caller. Set by `JwtAuthGuard` and therefore present
       * on every route that is not marked `@Public()`.
       */
      user?: AuthenticatedUser;

      /**
       * The authenticated platform operator. Set only by
       * `PlatformAdminAuthGuard`, on the small set of `/platform-admin/*`
       * routes - never on a tenant route, and never alongside `user`.
       */
      platformAdmin?: AuthenticatedPlatformAdmin;
    }
  }
}

export {};
