import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SubscriptionStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { SKIP_SUBSCRIPTION_CHECK_KEY } from '../decorators/skip-subscription-check.decorator';
import { ErrorCode } from '../enums/error-code.enum';

/**
 * Global billing gate. Runs after {@link RolesGuard}, so by this point the
 * caller is known to be allowed to hit the route - the question left is
 * whether their organization is allowed to use the product at all.
 *
 * Reads on {@link PrismaService} directly rather than the tenant-scoped
 * client: this guard runs before `TenantContextInterceptor` establishes the
 * AsyncLocalStorage context, so `TENANT_PRISMA` has nothing to scope by yet.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_SUBSCRIPTION_CHECK_KEY, [context.getHandler(), context.getClass()]);
    if (skip === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const organizationId = request.user?.organizationId;

    // No authenticated caller: a public route with nothing to gate. JwtAuthGuard
    // has already refused anything that needed a session but lacked one.
    if (organizationId === undefined) {
      return true;
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionStatus: true, trialEndsAt: true },
    });

    if (organization !== null && this.hasAccess(organization)) {
      return true;
    }

    throw new HttpException({ code: ErrorCode.SUBSCRIPTION_EXPIRED, message: "Your organization's subscription has expired" }, HttpStatus.PAYMENT_REQUIRED);
  }

  private hasAccess(organization: { subscriptionStatus: SubscriptionStatus; trialEndsAt: Date | null }): boolean {
    if (organization.subscriptionStatus === SubscriptionStatus.ACTIVE) {
      return true;
    }

    return organization.subscriptionStatus === SubscriptionStatus.TRIALING && organization.trialEndsAt !== null && organization.trialEndsAt.getTime() > Date.now();
  }
}
