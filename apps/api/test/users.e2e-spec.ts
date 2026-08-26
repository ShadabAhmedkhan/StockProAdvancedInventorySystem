import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PublicUser } from '../src/auth/dto/auth-response.dto';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { UserRole, UserStatus } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, emailFor, inviteTeammate, registerUser, TEST_PASSWORD, type TestApp } from './support/auth.helper';

describe('Users and RBAC (e2e)', () => {
  let context: TestApp;
  let adminToken: string;
  let adminId: string;
  let staffToken: string;

  beforeAll(async () => {
    context = await createTestApp();

    context.cleanup.push(async () => {
      await context.prisma.auditLog.deleteMany({ where: { userId: { in: context.createdUserIds } } });
    });

    // Self-registration founds a new organization and makes its registrant
    // ADMIN, so the admin comes first; everyone else joins as a teammate of
    // that same organization instead of founding their own.
    const admin = await registerUser(context, 'admin');
    adminId = admin.id;
    adminToken = admin.accessToken;

    staffToken = (await inviteTeammate(context, adminToken, 'staff', UserRole.STAFF)).accessToken;
    await inviteTeammate(context, adminToken, 'technician', UserRole.TECHNICIAN);
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('access control', () => {
    it('refuses an unauthenticated caller with 401', async () => {
      const response = await request(context.server).get('/api/v1/users').expect(401);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it('refuses a staff caller with 403, which is distinct from 401', async () => {
      const response = await request(context.server).get('/api/v1/users').set('Authorization', `Bearer ${staffToken}`).expect(403);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.FORBIDDEN);
    });

    it('admits an administrator', async () => {
      await request(context.server).get('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).expect(200);
    });

    it('refuses a staff caller from creating users', async () => {
      await request(context.server)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ firstName: 'A', lastName: 'B', email: emailFor(context, 'denied'), password: TEST_PASSWORD })
        .expect(403);
    });
  });

  describe('GET /users', () => {
    it('returns a page with its metadata merged into the envelope', async () => {
      const response = await request(context.server).get('/api/v1/users?page=1&limit=2').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const body = response.body as ApiResponse<PublicUser[]>;

      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeLessThanOrEqual(2);
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(2);
      expect(body.meta.total).toBeGreaterThan(0);
      expect(body.meta.totalPages).toBe(Math.ceil((body.meta.total ?? 0) / 2));
      expect(body.meta.requestId).toEqual(expect.any(String));
    });

    it('never includes a password hash', async () => {
      const response = await request(context.server).get('/api/v1/users?limit=100').set('Authorization', `Bearer ${adminToken}`).expect(200);

      expect(response.text).not.toContain('passwordHash');
      expect(response.text).not.toContain('argon2');
    });

    it('filters by role', async () => {
      const response = await request(context.server).get(`/api/v1/users?role=${UserRole.TECHNICIAN}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      const body = response.body as ApiResponse<PublicUser[]>;

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((user) => user.role === UserRole.TECHNICIAN)).toBe(true);
    });

    it('searches across name and email', async () => {
      const response = await request(context.server).get(`/api/v1/users?search=${context.run}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      const body = response.body as ApiResponse<PublicUser[]>;

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((user) => user.email.includes(context.run))).toBe(true);
    });

    it('sorts by a whitelisted column', async () => {
      const response = await request(context.server)
        .get('/api/v1/users?sortBy=email&sortOrder=asc&limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const emails = (response.body as ApiResponse<PublicUser[]>).data.map((user) => user.email);

      expect(emails).toEqual([...emails].sort((a, b) => a.localeCompare(b)));
    });

    it('pages without overlap', async () => {
      const first = await request(context.server).get('/api/v1/users?limit=2&page=1&sortBy=email&sortOrder=asc').set('Authorization', `Bearer ${adminToken}`);
      const second = await request(context.server).get('/api/v1/users?limit=2&page=2&sortBy=email&sortOrder=asc').set('Authorization', `Bearer ${adminToken}`);

      const firstIds = (first.body as ApiResponse<PublicUser[]>).data.map((user) => user.id);
      const secondIds = (second.body as ApiResponse<PublicUser[]>).data.map((user) => user.id);

      expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
    });

    it.each([
      ['an unlisted sort column', 'sortBy=passwordHash'],
      ['a limit above the cap', 'limit=1000'],
      ['a zero page', 'page=0'],
      ['a non-numeric page', 'page=abc'],
      ['an unknown role', 'role=SUPERUSER'],
      ['an unknown filter', 'isAdmin=true'],
    ])('rejects %s', async (_label, queryString: string) => {
      const response = await request(context.server).get(`/api/v1/users?${queryString}`).set('Authorization', `Bearer ${adminToken}`).expect(400);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe('POST /users', () => {
    it('lets an administrator create a user with an explicit role', async () => {
      const response = await request(context.server)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Made', lastName: 'ByAdmin', email: emailFor(context, 'created'), password: TEST_PASSWORD, role: UserRole.TECHNICIAN })
        .expect(201);

      const body = response.body as ApiResponse<PublicUser>;
      context.createdUserIds.push(body.data.id);

      expect(body.data.role).toBe(UserRole.TECHNICIAN);
      expect(body.data).not.toHaveProperty('passwordHash');
    });
  });

  describe('user administration', () => {
    it('refuses to let an administrator change their own role', async () => {
      const response = await request(context.server)
        .patch(`/api/v1/users/${adminId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: UserRole.STAFF })
        .expect(400);

      expect((response.body as ApiErrorResponse).message).toMatch(/your own role/i);
    });

    it('refuses to let an administrator deactivate themselves', async () => {
      await request(context.server)
        .patch(`/api/v1/users/${adminId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: UserStatus.INACTIVE })
        .expect(400);
    });

    it('ends every session when a user is suspended', async () => {
      const victim = await inviteTeammate(context, adminToken, 'victim', UserRole.STAFF);

      await request(context.server).get('/api/v1/auth/me').set('Authorization', `Bearer ${victim.accessToken}`).expect(200);

      await request(context.server)
        .patch(`/api/v1/users/${victim.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: UserStatus.SUSPENDED })
        .expect(200);

      await request(context.server).get('/api/v1/auth/me').set('Authorization', `Bearer ${victim.accessToken}`).expect(401);
      await request(context.server).post('/api/v1/auth/refresh').set('Cookie', victim.refreshCookie).expect(401);

      const live = await context.prisma.refreshToken.count({ where: { userId: victim.id, revokedAt: null } });
      expect(live).toBe(0);
    });

    it('promotes a user and the change is visible on their next call', async () => {
      const promoted = await inviteTeammate(context, adminToken, 'promoted', UserRole.STAFF);

      await request(context.server)
        .patch(`/api/v1/users/${promoted.id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: UserRole.MANAGER })
        .expect(200);

      const me = await request(context.server).get('/api/v1/auth/me').set('Authorization', `Bearer ${promoted.accessToken}`).expect(200);
      expect((me.body as ApiResponse<PublicUser>).data.role).toBe(UserRole.MANAGER);
    });

    it('rejects a malformed id before touching the database', async () => {
      await request(context.server).get('/api/v1/users/not-a-uuid').set('Authorization', `Bearer ${adminToken}`).expect(400);
    });

    it('returns 404 for an id that does not exist', async () => {
      const response = await request(context.server).get(`/api/v1/users/${randomUUID()}`).set('Authorization', `Bearer ${adminToken}`).expect(404);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.NOT_FOUND);
    });
  });
});
