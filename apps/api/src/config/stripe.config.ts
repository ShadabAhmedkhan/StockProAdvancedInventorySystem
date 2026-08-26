import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';

export interface StripeConfiguration {
  readonly secretKey: string | undefined;
  readonly webhookSecret: string | undefined;
  readonly priceId: string | undefined;
}

export const stripeConfig = registerAs('stripe', (): StripeConfiguration => {
  const env = validateEnv(process.env);

  return {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    priceId: env.STRIPE_PRICE_ID,
  };
});
