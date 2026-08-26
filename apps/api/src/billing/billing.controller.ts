import { BadRequestException, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { ErrorCode } from '../common/enums/error-code.enum';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { SubscriptionStatus, UserRole } from '../generated/prisma/enums';
import { BillingService } from './billing.service';

const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

/**
 * A lapsed org must still be able to reach these routes to pay its way back
 * in, so every handler here skips {@link SubscriptionGuard} at the class
 * level - that guard exists to gate the rest of the product, not billing
 * itself.
 */
@ApiBearerAuth('access-token')
@ApiTags('Billing')
@SkipSubscriptionCheck()
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /** Any authenticated role may see the organization's billing state; only an admin may act on it. */
  @Get('status')
  @ApiOperation({ summary: "This organization's subscription status" })
  status(@CurrentUser() caller: AuthenticatedUser): Promise<{ subscriptionStatus: SubscriptionStatus; trialEndsAt: Date | null; canManageBilling: boolean }> {
    return this.billingService.status(caller.organizationId);
  }

  @Roles(UserRole.ADMIN)
  @Post('checkout-session')
  @ApiOperation({ summary: 'Start a Stripe Checkout session for this organization' })
  createCheckoutSession(@CurrentUser() caller: AuthenticatedUser): Promise<{ url: string }> {
    return this.billingService.createCheckoutSession(caller.organizationId, caller.email);
  }

  @Roles(UserRole.ADMIN)
  @Post('portal-session')
  @ApiOperation({ summary: 'Open the Stripe Billing Portal for this organization' })
  createPortalSession(@CurrentUser() caller: AuthenticatedUser): Promise<{ url: string }> {
    return this.billingService.createPortalSession(caller.organizationId);
  }

  /**
   * Stripe calls this with no session of any kind - the signature over the
   * raw request body is the only credential. `req.rawBody` is populated by
   * Nest's `rawBody: true` bootstrap option precisely so this handler can see
   * the exact bytes Stripe signed, rather than a re-serialised copy of the
   * parsed JSON that would not verify.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook endpoint - signature verified, not for browser use' })
  async webhook(@Req() request: RawBodyRequest<Request>, @Headers(STRIPE_SIGNATURE_HEADER) signature: string | undefined): Promise<{ received: true }> {
    if (signature === undefined || request.rawBody === undefined) {
      throw new BadRequestException({ code: ErrorCode.BAD_REQUEST, message: 'Missing Stripe signature or request body' });
    }

    await this.billingService.handleWebhook(request.rawBody, signature);
    return { received: true };
  }
}
