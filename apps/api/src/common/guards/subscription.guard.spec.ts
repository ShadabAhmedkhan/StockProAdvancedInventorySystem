import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ErrorCode } from '../enums/error-code.enum';
import { SubscriptionStatus, UserRole } from '../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { SubscriptionGuard } from './subscription.guard';

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

function guard(skip: boolean | undefined, findUnique: jest.Mock): SubscriptionGuard {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(skip);
  const prisma = { organization: { findUnique } } as unknown as PrismaService;
  return new SubscriptionGuard(reflector, prisma);
}

const user: AuthenticatedUser = { id: 'user-1', email: 'admin@stockpro.test', role: UserRole.ADMIN, organizationId: 'org-1' };

describe('SubscriptionGuard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips the check on a route decorated with @SkipSubscriptionCheck', async () => {
    const findUnique = jest.fn();
    await expect(guard(true, findUnique).canActivate(contextFor(user))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('lets an unauthenticated request through - nothing to gate', async () => {
    const findUnique = jest.fn();
    await expect(guard(undefined, findUnique).canActivate(contextFor(undefined))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('allows an active subscription', async () => {
    const findUnique = jest.fn().mockResolvedValue({ subscriptionStatus: SubscriptionStatus.ACTIVE, trialEndsAt: null });
    await expect(guard(undefined, findUnique).canActivate(contextFor(user))).resolves.toBe(true);
  });

  it('allows a trial that has not yet ended', async () => {
    const trialEndsAt = new Date(Date.now() + 86_400_000);
    const findUnique = jest.fn().mockResolvedValue({ subscriptionStatus: SubscriptionStatus.TRIALING, trialEndsAt });
    await expect(guard(undefined, findUnique).canActivate(contextFor(user))).resolves.toBe(true);
  });

  it('refuses a trial that has ended', async () => {
    const trialEndsAt = new Date(Date.now() - 1000);
    const findUnique = jest.fn().mockResolvedValue({ subscriptionStatus: SubscriptionStatus.TRIALING, trialEndsAt });

    await expect(guard(undefined, findUnique).canActivate(contextFor(user))).rejects.toThrow(HttpException);
  });

  it.each([SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELED])('refuses a %s subscription', async (subscriptionStatus) => {
    const findUnique = jest.fn().mockResolvedValue({ subscriptionStatus, trialEndsAt: null });

    await expect(guard(undefined, findUnique).canActivate(contextFor(user))).rejects.toThrow(HttpException);
  });

  it('reports the failure as SUBSCRIPTION_EXPIRED with a 402', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);

    try {
      await guard(undefined, findUnique).canActivate(contextFor(user));
      throw new Error('expected canActivate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(402);
      expect((exception.getResponse() as { code: string }).code).toBe(ErrorCode.SUBSCRIPTION_EXPIRED);
    }
  });
});
