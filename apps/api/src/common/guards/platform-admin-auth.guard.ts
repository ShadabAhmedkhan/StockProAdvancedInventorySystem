import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { platformAdminConfig } from '../../config/platform-admin.config';
import { ErrorCode } from '../enums/error-code.enum';
import type { AuthenticatedPlatformAdmin, PlatformAdminAccessTokenPayload } from '../interfaces/authenticated-platform-admin.interface';

const BEARER = /^Bearer (.+)$/;

function readPayload(payload: unknown): AuthenticatedPlatformAdmin | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  if (!('sub' in payload) || !('email' in payload) || !('kind' in payload)) {
    return undefined;
  }

  const { sub, email, kind } = payload as Partial<PlatformAdminAccessTokenPayload>;
  if (typeof sub !== 'string' || sub === '' || typeof email !== 'string' || kind !== 'platform_admin') {
    return undefined;
  }

  return { id: sub, email };
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.header('authorization');
  return header === undefined ? undefined : (BEARER.exec(header)?.[1] ?? undefined);
}

/**
 * Guards `/platform-admin/*` routes only - applied locally on
 * `PlatformAdminController`, never registered as an `APP_GUARD`. Verifies
 * against `PLATFORM_ADMIN_JWT_SECRET`, a secret the tenant `JwtAuthGuard`
 * never checks against and vice versa, so a tenant access token and a
 * platform-admin access token can never authenticate each other's routes.
 *
 * Deliberately does not call `enterTenantContext`: a platform-admin request
 * has no organization, so any accidental use of the tenant-scoped Prisma
 * client inside this module throws (`getCurrentOrgId()` is fail-closed)
 * instead of silently leaking or mis-scoping.
 */
@Injectable()
export class PlatformAdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(platformAdminConfig.KEY) private readonly config: ConfigType<typeof platformAdminConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    if (token === undefined) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Authentication required' });
    }

    let platformAdmin: AuthenticatedPlatformAdmin | undefined;
    try {
      platformAdmin = readPayload(await this.jwtService.verifyAsync<Record<string, unknown>>(token, { secret: this.config.jwtSecret }));
    } catch {
      platformAdmin = undefined;
    }

    if (platformAdmin === undefined) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Invalid or expired access token' });
    }

    request.platformAdmin = platformAdmin;
    return true;
  }
}
