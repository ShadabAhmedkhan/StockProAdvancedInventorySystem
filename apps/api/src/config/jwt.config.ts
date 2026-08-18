import { registerAs } from '@nestjs/config';
import { parseDuration } from '../common/utils/duration.util';
import { NodeEnvironment, validateEnv } from './env.validation';

export interface JwtConfiguration {
  readonly accessSecret: string;
  /**
   * Access-token lifetime in seconds. Kept as a number rather than the raw
   * `15m` string because that is what both the signer and the client field
   * want, and it needs no reparsing at either end.
   */
  readonly accessExpiresInSeconds: number;
  readonly refreshSecret: string;
  readonly refreshExpiresInMs: number;
  readonly cookie: RefreshCookieConfiguration;
}

export interface RefreshCookieConfiguration {
  readonly name: string;
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax' | 'none';
  /**
   * Scoped to the auth routes so the refresh token is not attached to every
   * request; only /refresh and /logout ever need it.
   */
  readonly path: string;
  readonly maxAgeMs: number;
}

const MILLISECONDS_PER_SECOND = 1000;

export const REFRESH_COOKIE_NAME = 'stockpro_refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export const jwtConfig = registerAs('jwt', (): JwtConfiguration => {
  const env = validateEnv(process.env);
  const isProduction = env.NODE_ENV === NodeEnvironment.Production;
  const refreshExpiresInMs = parseDuration(env.JWT_REFRESH_EXPIRES_IN);

  return {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessExpiresInSeconds: Math.floor(parseDuration(env.JWT_ACCESS_EXPIRES_IN) / MILLISECONDS_PER_SECOND),
    refreshSecret: env.JWT_REFRESH_SECRET,
    refreshExpiresInMs,
    cookie: {
      name: REFRESH_COOKIE_NAME,
      httpOnly: true,
      // Production is assumed to serve the dashboard from a different origin
      // than the API, which requires SameSite=None, which in turn requires
      // Secure. Locally both are on localhost, where Lax works over plain HTTP.
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAgeMs: refreshExpiresInMs,
    },
  };
});
