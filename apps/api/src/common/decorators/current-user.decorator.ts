import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Injects the authenticated caller.
 *
 * Only reachable on routes the authentication guard has already admitted, so
 * `request.user` is guaranteed to be set; the throw guards against a future
 * route that is marked public but still asks for a user.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser => {
  const user = context.switchToHttp().getRequest<Request>().user;

  if (user === undefined) {
    throw new Error('CurrentUser was used on a route that does not require authentication');
  }

  return user;
});
