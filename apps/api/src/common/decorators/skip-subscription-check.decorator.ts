import { SetMetadata } from '@nestjs/common';

export const SKIP_SUBSCRIPTION_CHECK_KEY = 'stockpro:skipSubscriptionCheck';

/**
 * Opts a route out of {@link SubscriptionGuard}.
 *
 * A lapsed org must still be able to sign in, sign out, and manage its own
 * billing - otherwise there would be no way to pay and get back in.
 */
export const SkipSubscriptionCheck = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_SUBSCRIPTION_CHECK_KEY, true);
