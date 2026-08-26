import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';

export interface PlatformAdminConfiguration {
  readonly jwtSecret: string;
  /** Short-lived only: this identity has no refresh-token rotation, so a stolen token expires fast. */
  readonly jwtExpiresInSeconds: number;
}

const PLATFORM_ADMIN_TOKEN_TTL_SECONDS = 15 * 60;

export const platformAdminConfig = registerAs('platformAdmin', (): PlatformAdminConfiguration => {
  const env = validateEnv(process.env);

  return {
    jwtSecret: env.PLATFORM_ADMIN_JWT_SECRET,
    jwtExpiresInSeconds: PLATFORM_ADMIN_TOKEN_TTL_SECONDS,
  };
});
