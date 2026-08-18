import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '../../generated/prisma/enums';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ErrorCode } from '../enums/error-code.enum';

/**
 * Global authorisation guard. Runs after {@link JwtAuthGuard}, so a route
 * without `@Roles()` is open to any authenticated caller.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (required === undefined || required.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<Request>().user;

    if (user === undefined) {
      // Reachable only if a route carries @Roles() and @Public() together,
      // which is a wiring mistake; refusing is the safe reading.
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Authentication required' });
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: 'You do not have permission to perform this action' });
    }

    return true;
  }
}
