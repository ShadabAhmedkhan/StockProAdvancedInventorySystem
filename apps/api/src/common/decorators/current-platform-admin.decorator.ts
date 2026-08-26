import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedPlatformAdmin } from '../interfaces/authenticated-platform-admin.interface';

/** Injects the authenticated platform operator. Only reachable on routes behind {@link PlatformAdminAuthGuard}. */
export const CurrentPlatformAdmin = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedPlatformAdmin => {
  const platformAdmin = context.switchToHttp().getRequest<Request>().platformAdmin;

  if (platformAdmin === undefined) {
    throw new Error('CurrentPlatformAdmin was used on a route that does not require platform-admin authentication');
  }

  return platformAdmin;
});
