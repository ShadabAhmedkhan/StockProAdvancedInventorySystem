/**
 * Deliberately not shared with `auth-token.ts`: the platform-admin token and
 * a tenant access token must never be able to cross-contaminate a request,
 * so they live in separate module-level variables with separate accessors.
 * Same in-memory-only lifetime as the tenant token - gone on a hard refresh,
 * which is fine here since there is no refresh-token flow for this identity.
 */
let platformAdminToken: string | null = null;
let platformAdminEmail: string | null = null;

export function getPlatformAdminToken(): string | null {
  return platformAdminToken;
}

export function setPlatformAdminSession(token: string | null, email: string | null): void {
  platformAdminToken = token;
  platformAdminEmail = email;
}

export function getPlatformAdminEmail(): string | null {
  return platformAdminEmail;
}
