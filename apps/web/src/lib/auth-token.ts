/**
 * The access token is never persisted (localStorage/cookie): it lives only in
 * this module-level variable, so it is unreachable by anything other than
 * same-page JavaScript and is gone on a hard refresh. The refresh endpoint's
 * httpOnly cookie is what makes a hard refresh recoverable.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
