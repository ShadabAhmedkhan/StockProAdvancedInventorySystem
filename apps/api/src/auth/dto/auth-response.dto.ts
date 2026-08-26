import type { UserRole, UserStatus } from '../../generated/prisma/enums';

/**
 * A user as returned by the API. Constructed by explicit `select`, so a
 * password hash cannot reach a response by being added to the model later.
 */
export interface PublicUser {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResult {
  /**
   * Short-lived bearer token. Returned in the body for the client to hold in
   * memory; the refresh token travels only in an httpOnly cookie, so no
   * long-lived credential is ever reachable from JavaScript.
   */
  accessToken: string;
  /** Access-token lifetime in seconds, so a client can refresh ahead of expiry. */
  expiresIn: number;
  tokenType: 'Bearer';
  user: PublicUser;
}
