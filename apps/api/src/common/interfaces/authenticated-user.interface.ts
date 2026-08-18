import type { UserRole } from '../../generated/prisma/enums';

/**
 * The caller, as proven by a verified access token.
 *
 * Deliberately carries only what authorisation needs. Anything else - and any
 * value that must be current rather than as-of-token-issue - is read from the
 * database by the endpoint that needs it.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

/** Claims carried by an access token. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}
