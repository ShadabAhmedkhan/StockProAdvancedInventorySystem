import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/enums';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { RolesGuard } from './roles.guard';

/** Stands in for the controller class the reflector reads metadata from. */
class TestTarget {
  handle(): void {
    return undefined;
  }
}

function contextFor(user: AuthenticatedUser | undefined): ExecutionContext {
  const request = { user } as unknown as Request;

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => TestTarget,
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: UserRole[] | undefined): RolesGuard {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
  return new RolesGuard(reflector);
}

const staff: AuthenticatedUser = { id: 'user-1', email: 'staff@stockpro.test', role: UserRole.STAFF };
const admin: AuthenticatedUser = { id: 'user-2', email: 'admin@stockpro.test', role: UserRole.ADMIN };

describe('RolesGuard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows any authenticated caller when a route declares no roles', () => {
    expect(guardRequiring(undefined).canActivate(contextFor(staff))).toBe(true);
    expect(guardRequiring([]).canActivate(contextFor(staff))).toBe(true);
  });

  it('allows a caller holding one of the required roles', () => {
    expect(guardRequiring([UserRole.ADMIN, UserRole.MANAGER]).canActivate(contextFor(admin))).toBe(true);
  });

  it('refuses a caller whose role is not listed', () => {
    expect(() => guardRequiring([UserRole.ADMIN]).canActivate(contextFor(staff))).toThrow(ForbiddenException);
  });

  it('refuses rather than allows when a restricted route somehow has no caller', () => {
    expect(() => guardRequiring([UserRole.ADMIN]).canActivate(contextFor(undefined))).toThrow(UnauthorizedException);
  });
});
