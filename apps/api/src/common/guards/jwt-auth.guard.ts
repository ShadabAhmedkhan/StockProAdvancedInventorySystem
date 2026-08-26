import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { jwtConfig } from '../../config/jwt.config';
import { UserRole } from '../../generated/prisma/enums';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ErrorCode } from '../enums/error-code.enum';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

const BEARER = /^Bearer (.+)$/;

const KNOWN_ROLES = new Set<string>(Object.values(UserRole));

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && KNOWN_ROLES.has(value);
}

/**
 * Reads the caller out of a verified token.
 *
 * The payload is validated field by field rather than trusted from the generic
 * parameter of `verifyAsync`: a token signed with the right key but an
 * unexpected shape - an old format, or one minted by another service sharing
 * the secret - must be rejected, not coerced.
 */
function readPayload(payload: unknown): AuthenticatedUser | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  if (!('sub' in payload) || !('email' in payload) || !('role' in payload) || !('organizationId' in payload)) {
    return undefined;
  }

  const { sub, email, role, organizationId } = payload;
  if (typeof sub !== 'string' || sub === '' || typeof email !== 'string' || !isUserRole(role) || typeof organizationId !== 'string' || organizationId === '') {
    return undefined;
  }

  return { id: sub, email, role, organizationId };
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.header('authorization');
  return header === undefined ? undefined : (BEARER.exec(header)?.[1] ?? undefined);
}

/**
 * Global authentication guard. Every route requires a valid access token
 * unless it is marked `@Public()`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY) private readonly config: ConfigType<typeof jwtConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    if (token === undefined) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Authentication required' });
    }

    // Every failure - expired, wrong signature, malformed, unexpected claims -
    // returns the same message. Distinguishing them tells an attacker which
    // part of a forged token to fix next.
    let user: AuthenticatedUser | undefined;
    try {
      user = readPayload(await this.jwtService.verifyAsync<Record<string, unknown>>(token, { secret: this.config.accessSecret }));
    } catch {
      user = undefined;
    }

    if (user === undefined) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Invalid or expired access token' });
    }

    // Only sets `request.user` here - it does not establish the tenant context itself.
    // A guard's `canActivate` completing does not hand off to the controller as a direct
    // continuation (Nest calls the handler through its own RxJS pipeline afterward), so
    // an `enterWith` here would not survive into the controller/service call. That is
    // `TenantContextInterceptor`'s job, reading `request.user` right before `next.handle()`.
    request.user = user;
    return true;
  }
}
