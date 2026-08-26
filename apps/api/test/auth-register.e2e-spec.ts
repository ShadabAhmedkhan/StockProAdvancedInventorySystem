import request from 'supertest';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import type { AuthResult } from '../src/auth/dto/auth-response.dto';
import { UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, emailFor, refreshCookie, registerUser, TEST_PASSWORD, type TestApp } from './support/auth.helper';

describe('POST /auth/register (e2e)', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('creates an account and returns a signed-in session', async () => {
    const response = await request(context.server)
      .post('/api/v1/auth/register')
      .send({ firstName: 'Test', lastName: 'Fresh', email: emailFor(context, 'fresh'), password: TEST_PASSWORD, organizationName: `Org Fresh ${context.run}` })
      .expect(201);

    const body = response.body as ApiResponse<AuthResult>;
    context.createdUserIds.push(body.data.user.id);

    expect(body.data.tokenType).toBe('Bearer');
    expect(body.data.expiresIn).toBeGreaterThan(0);
    expect(body.data.accessToken.split('.')).toHaveLength(3);
    expect(body.data.user.email).toBe(emailFor(context, 'fresh'));
    // Self-registration founds a new organization and makes its registrant ADMIN.
    expect(body.data.user.role).toBe(UserRole.ADMIN);
    expect(refreshCookie(response)).toBeDefined();

    // The password hash must not reach the client by any route.
    expect(body.data.user).not.toHaveProperty('passwordHash');
    expect(response.text).not.toContain('argon2');
    expect(response.text).not.toContain(TEST_PASSWORD);
  });

  it('stores an Argon2id hash rather than the password', async () => {
    const user = await registerUser(context, 'hashed');
    const stored = await context.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });

    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it('refuses to let a self-registration choose its own role', async () => {
    const response = await request(context.server)
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Mallory',
        lastName: 'Elevated',
        email: emailFor(context, 'elevated'),
        password: TEST_PASSWORD,
        organizationName: `Org Elevated ${context.run}`,
        role: UserRole.ADMIN,
      })
      .expect(400);

    // forbidNonWhitelisted rejects the unknown property outright rather than
    // dropping it silently, so the attempt is visible instead of quiet.
    expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.VALIDATION_ERROR);

    const created = await context.prisma.user.findUnique({ where: { email: emailFor(context, 'elevated') }, select: { id: true } });
    expect(created).toBeNull();
  });

  it('rejects a duplicate email', async () => {
    const existing = await registerUser(context, 'duplicate');

    const response = await request(context.server)
      .post('/api/v1/auth/register')
      .send({ firstName: 'Test', lastName: 'Again', email: existing.email, password: TEST_PASSWORD, organizationName: `Org Again ${context.run}` })
      .expect(409);

    expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.CONFLICT);
  });

  it.each([
    ['no digit', 'NoDigitsHere'],
    ['no upper-case letter', 'nouppercase1'],
    ['fewer than ten characters', 'Short1'],
  ])('rejects a password with %s', async (label: string, password: string) => {
    const response = await request(context.server)
      .post('/api/v1/auth/register')
      .send({ firstName: 'Test', lastName: 'Weak', email: emailFor(context, `weak-${label.length}`), password, organizationName: `Org Weak ${context.run}` })
      .expect(400);

    const body = response.body as ApiErrorResponse;
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.errors?.some((error) => error.field === 'password')).toBe(true);
  });

  it('reports every invalid field at once rather than one at a time', async () => {
    const response = await request(context.server).post('/api/v1/auth/register').send({ email: 'not-an-email', password: 'weak' }).expect(400);

    const fields = (response.body as ApiErrorResponse).errors?.map((error) => error.field) ?? [];
    expect(fields).toEqual(expect.arrayContaining(['firstName', 'lastName', 'email', 'password', 'organizationName']));
  });
});
