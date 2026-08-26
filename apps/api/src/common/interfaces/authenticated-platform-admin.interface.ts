/**
 * The platform operator, as proven by a verified platform-admin access token.
 *
 * Deliberately unrelated to {@link AuthenticatedUser}: no `role`, no
 * `organizationId` - this identity is not a member of any tenant.
 */
export interface AuthenticatedPlatformAdmin {
  id: string;
  email: string;
}

/** Claims carried by a platform-admin access token. `kind` distinguishes it
 * from a tenant {@link AccessTokenPayload} signed with a different secret. */
export interface PlatformAdminAccessTokenPayload {
  sub: string;
  email: string;
  kind: 'platform_admin';
  iat: number;
  exp: number;
}
