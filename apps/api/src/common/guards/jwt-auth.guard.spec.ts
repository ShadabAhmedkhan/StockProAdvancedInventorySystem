import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { JwtConfiguration } from '../../config/jwt.config';
import { UserRole } from '../../generated/prisma/enums';
import { JwtAuthGuard } from './jwt-auth.guard';

const ACCESS_SECRET = 'access-secret-that-is-long-enough-for-hs256';
const OTHER_SECRET = 'a-different-secret-that-is-also-long-enough';

const config = { accessSecret: ACCESS_SECRET } as JwtConfiguration;

/** Stands in for the controller class the reflector reads metadata from. */
class TestTarget {
  handle(): void {
    return undefined;
  }
}

interface Harness {
  guard: JwtAuthGuard;
  request: Request;
  context: ExecutionContext;
}

function harness(authorization: string | undefined, isPublic = false): Harness {
  const request = {
    header: (name: string): string | undefined => (name.toLowerCase() === 'authorization' ? authorization : undefined),
  } as unknown as Request;

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => TestTarget,
  } as unknown as ExecutionContext;

  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);

  return { guard: new JwtAuthGuard(reflector, new JwtService({}), config), request, context };
}

function sign(payload: Record<string, unknown>, secret = ACCESS_SECRET, expiresIn = 900): string {
  return new JwtService({}).sign(payload, { secret, expiresIn });
}

const validPayload = { sub: 'user-1', email: 'staff@stockpro.test', role: UserRole.STAFF, organizationId: 'org-1' };

describe('JwtAuthGuard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets a public route through without a token', async () => {
    const { guard, context, request } = harness(undefined, true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('attaches the caller from a valid token', async () => {
    const { guard, context, request } = harness(`Bearer ${sign(validPayload)}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'staff@stockpro.test', role: UserRole.STAFF, organizationId: 'org-1' });
  });

  it('refuses a request with no Authorization header', async () => {
    const { guard, context } = harness(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it.each([
    ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['a bare token', 'abc.def.ghi'],
    ['an empty bearer', 'Bearer '],
    ['garbage', 'Bearer not-a-jwt'],
  ])('refuses %s', async (_label, header: string) => {
    const { guard, context } = harness(header);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('refuses a token signed with the wrong secret', async () => {
    const { guard, context } = harness(`Bearer ${sign(validPayload, OTHER_SECRET)}`);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('refuses an expired token', async () => {
    const { guard, context } = harness(`Bearer ${sign(validPayload, ACCESS_SECRET, -1)}`);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it.each([
    ['no subject', { email: 'a@b.test', role: UserRole.STAFF }],
    ['an empty subject', { sub: '', email: 'a@b.test', role: UserRole.STAFF }],
    ['no role', { sub: 'user-1', email: 'a@b.test' }],
    ['an unknown role', { sub: 'user-1', email: 'a@b.test', role: 'SUPERUSER' }],
    ['a numeric subject', { sub: 42, email: 'a@b.test', role: UserRole.STAFF }],
  ])('refuses a correctly signed token with %s', async (_label, payload: Record<string, unknown>) => {
    const { guard, context } = harness(`Bearer ${sign(payload)}`);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
