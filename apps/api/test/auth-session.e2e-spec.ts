import request from 'supertest';
import type { AuthResult, PublicUser } from '../src/auth/dto/auth-response.dto';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { REFRESH_COOKIE_NAME } from '../src/config/jwt.config';
import { UserRole, UserStatus } from '../src/generated/prisma/enums';
import { closeTestApp, cookieValue, createTestApp, emailFor, refreshCookie, registerUser, TEST_PASSWORD, type TestApp } from './support/auth.helper';

describe('Sessions (e2e)', () => {
  let context: TestApp;
  let signedIn: { id: string; email: string; accessToken: string; refreshCookie: string };
  let loginCookie: string;

  beforeAll(async () => {
    context = await createTestApp();
    signedIn = await registerUser(context, 'session');

    // Login attempt 1 of the 5 allowed per minute.
    const login = await request(context.server).post('/api/v1/auth/login').send({ email: signedIn.email, password: TEST_PASSWORD }).expect(200);
    loginCookie = refreshCookie(login) ?? '';
    signedIn.accessToken = (login.body as ApiResponse<AuthResult>).data.accessToken;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('POST /auth/login', () => {
    it('puts the refresh token in an httpOnly cookie scoped to the auth routes', () => {
      expect(loginCookie).toContain('HttpOnly');
      expect(loginCookie).toContain('Path=/api/v1/auth');
      expect(loginCookie).toContain('SameSite=Lax');
    });

    it('stores only a digest of the refresh token', async () => {
      const stored = await context.prisma.refreshToken.findFirst({
        where: { userId: signedIn.id },
        orderBy: { createdAt: 'desc' },
        select: { tokenHash: true },
      });

      expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored?.tokenHash).not.toBe(cookieValue(loginCookie));
    });

    it('records the sign-in time', async () => {
      const user = await context.prisma.user.findUniqueOrThrow({ where: { id: signedIn.id }, select: { lastLoginAt: true } });

      expect(user.lastLoginAt).not.toBeNull();
    });

    it('answers a wrong password and an unknown account identically', async () => {
      // Login attempts 2 and 3 of 5.
      const wrongPassword = await request(context.server).post('/api/v1/auth/login').send({ email: signedIn.email, password: 'WrongPassword1' }).expect(401);
      const unknownEmail = await request(context.server)
        .post('/api/v1/auth/login')
        .send({ email: emailFor(context, 'nobody'), password: TEST_PASSWORD })
        .expect(401);

      const first = wrongPassword.body as ApiErrorResponse;
      const second = unknownEmail.body as ApiErrorResponse;

      expect(first.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(first.code).toBe(second.code);
      expect(first.message).toBe(second.message);
    });

    it('refuses a suspended account that supplies the right password', async () => {
      const victim = await registerUser(context, 'suspended');
      await context.prisma.user.update({ where: { id: victim.id }, data: { status: UserStatus.SUSPENDED } });

      // Login attempt 4 of 5.
      const response = await request(context.server).post('/api/v1/auth/login').send({ email: victim.email, password: TEST_PASSWORD }).expect(403);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.FORBIDDEN);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the signed-in user without the password hash', async () => {
      const response = await request(context.server).get('/api/v1/auth/me').set('Authorization', `Bearer ${signedIn.accessToken}`).expect(200);
      const body = response.body as ApiResponse<PublicUser>;

      expect(body.data.id).toBe(signedIn.id);
      expect(body.data.role).toBe(UserRole.STAFF);
      expect(body.data).not.toHaveProperty('passwordHash');
    });

    it.each([
      ['no token', undefined],
      ['a malformed token', 'Bearer not-a-jwt'],
      ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
      ['an empty bearer', 'Bearer '],
    ])('refuses a request with %s', async (_label, authorization: string | undefined) => {
      const call = request(context.server).get('/api/v1/auth/me');
      if (authorization !== undefined) {
        void call.set('Authorization', authorization);
      }

      const response = await call.expect(401);
      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it('reflects a role change immediately, without a new token', async () => {
      await context.prisma.user.update({ where: { id: signedIn.id }, data: { role: UserRole.MANAGER } });

      const response = await request(context.server).get('/api/v1/auth/me').set('Authorization', `Bearer ${signedIn.accessToken}`).expect(200);
      expect((response.body as ApiResponse<PublicUser>).data.role).toBe(UserRole.MANAGER);

      await context.prisma.user.update({ where: { id: signedIn.id }, data: { role: UserRole.STAFF } });
    });

    it('refuses a still-valid token whose account was deactivated', async () => {
      await context.prisma.user.update({ where: { id: signedIn.id }, data: { status: UserStatus.SUSPENDED } });

      await request(context.server).get('/api/v1/auth/me').set('Authorization', `Bearer ${signedIn.accessToken}`).expect(401);

      await context.prisma.user.update({ where: { id: signedIn.id }, data: { status: UserStatus.ACTIVE } });
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the cookie and issues a new access token', async () => {
      const user = await registerUser(context, 'rotate');

      const refreshed = await request(context.server).post('/api/v1/auth/refresh').set('Cookie', user.refreshCookie).expect(200);
      const rotated = refreshCookie(refreshed) ?? '';

      expect((refreshed.body as ApiResponse<AuthResult>).data.accessToken.split('.')).toHaveLength(3);
      expect(cookieValue(rotated)).not.toBe(cookieValue(user.refreshCookie));
      expect(rotated).toContain('HttpOnly');
    });

    it.each([
      ['no cookie', undefined],
      ['a fabricated token', `${REFRESH_COOKIE_NAME}=not-a-real-token`],
      ['an empty cookie', `${REFRESH_COOKIE_NAME}=`],
    ])('refuses a request with %s', async (_label, cookie: string | undefined) => {
      const call = request(context.server).post('/api/v1/auth/refresh');
      if (cookie !== undefined) {
        void call.set('Cookie', cookie);
      }

      const response = await call.expect(401);
      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it('treats replay of a spent token as theft and ends every session', async () => {
      const user = await registerUser(context, 'replay');

      const rotated = await request(context.server).post('/api/v1/auth/refresh').set('Cookie', user.refreshCookie).expect(200);
      const current = refreshCookie(rotated) ?? '';

      // Presenting the spent token again is the signal that it leaked.
      await request(context.server).post('/api/v1/auth/refresh').set('Cookie', user.refreshCookie).expect(401);

      // The thief is locked out - and so is the token that was rotated from it,
      // so the legitimate holder is forced to sign in again.
      await request(context.server).post('/api/v1/auth/refresh').set('Cookie', current).expect(401);

      const live = await context.prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
      expect(live).toBe(0);
    });

    it('clears the browser cookie when a refresh fails', async () => {
      const response = await request(context.server).post('/api/v1/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=bogus`).expect(401);

      expect(refreshCookie(response)).toContain(`${REFRESH_COOKIE_NAME}=;`);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session and clears the cookie', async () => {
      const user = await registerUser(context, 'logout');

      const response = await request(context.server).post('/api/v1/auth/logout').set('Cookie', user.refreshCookie).expect(200);
      expect(refreshCookie(response)).toContain(`${REFRESH_COOKIE_NAME}=;`);

      await request(context.server).post('/api/v1/auth/refresh').set('Cookie', user.refreshCookie).expect(401);
    });

    it('succeeds without a cookie rather than erroring', async () => {
      await request(context.server).post('/api/v1/auth/logout').expect(200);
    });
  });
});
