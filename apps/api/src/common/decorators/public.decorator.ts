import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'stockpro:isPublic';

/**
 * Opts a route out of the global authentication guard.
 *
 * Authentication is on by default for the whole API, so forgetting a guard
 * fails closed. Exposing an endpoint is the explicit, greppable act.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
