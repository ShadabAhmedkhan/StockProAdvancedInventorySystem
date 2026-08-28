import request from 'supertest';
import { EmailService, type EmailMessage } from '../src/common/email/email.service';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse } from '../src/common/interfaces/api-response.interface';
import { closeTestApp, createTestApp, emailFor, registerUser, TEST_PASSWORD, type TestApp } from './support/auth.helper';

function lastSentEmail(spy: jest.SpyInstance<Promise<void>, [EmailMessage]>): EmailMessage {
  const call = spy.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('EmailService.send was never called');
  }
  return call[0];
}

/** Extracts the `?token=...` value from the reset link inside the emailed HTML. */
function tokenFromEmail(message: EmailMessage): string {
  const match = /token=([^"&\s]+)/.exec(message.html);
  if (match?.[1] === undefined) {
    throw new Error(`No reset token found in email body: ${message.html}`);
  }
  return match[1];
}

describe('Password recovery (e2e)', () => {
  let context: TestApp;
  let sendSpy: jest.SpyInstance<Promise<void>, [EmailMessage]>;

  beforeAll(async () => {
    context = await createTestApp();
    sendSpy = jest.spyOn(context.app.get(EmailService), 'send').mockResolvedValue(undefined);
  });

  afterEach(() => {
    sendSpy.mockClear();
  });

  afterAll(async () => {
    sendSpy.mockRestore();
    await closeTestApp(context);
  });

  it('emails a reset link for a real account and completes the full recovery workflow', async () => {
    const user = await registerUser(context, 'recover');

    await request(context.server).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const token = tokenFromEmail(lastSentEmail(sendSpy));

    const newPassword = 'BrandNewPassword1';
    await request(context.server).post('/api/v1/auth/reset-password').send({ token, password: newPassword }).expect(200);

    // The old password no longer works...
    await request(context.server).post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(401);
    // ...and the new one does.
    await request(context.server).post('/api/v1/auth/login').send({ email: user.email, password: newPassword }).expect(200);
  });

  it('revokes every existing refresh session once the password is reset', async () => {
    const user = await registerUser(context, 'revoke-sessions');

    await request(context.server).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    const token = tokenFromEmail(lastSentEmail(sendSpy));

    await request(context.server).post('/api/v1/auth/reset-password').send({ token, password: 'AnotherNewPass1' }).expect(200);

    // The session that existed before the reset must not survive it.
    await request(context.server).post('/api/v1/auth/refresh').set('Cookie', user.refreshCookie).expect(401);
  });

  it('cannot be replayed: a spent token is rejected on a second attempt', async () => {
    const user = await registerUser(context, 'single-use');

    await request(context.server).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    const token = tokenFromEmail(lastSentEmail(sendSpy));

    await request(context.server).post('/api/v1/auth/reset-password').send({ token, password: 'FirstAttempt1' }).expect(200);

    const replay = await request(context.server).post('/api/v1/auth/reset-password').send({ token, password: 'SecondAttempt1' }).expect(401);
    expect((replay.body as ApiErrorResponse).code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('rejects an unknown or malformed token without leaking which', async () => {
    const response = await request(context.server)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'not-a-real-token', password: 'WhateverPass1' })
      .expect(401);

    expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('responds identically for a registered and an unregistered email, so the endpoint cannot enumerate accounts', async () => {
    const user = await registerUser(context, 'enumeration-known');
    const unknownEmail = emailFor(context, 'enumeration-unknown');

    const known = await request(context.server).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    const unknown = await request(context.server).post('/api/v1/auth/forgot-password').send({ email: unknownEmail }).expect(200);

    expect((known.body as { data: unknown }).data).toEqual((unknown.body as { data: unknown }).data);
    // Only the real account actually gets an email.
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('does not email a deactivated account', async () => {
    const user = await registerUser(context, 'deactivated');
    await context.prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });

    await request(context.server).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('rejects a new password that fails the strength rules', async () => {
    const response = await request(context.server).post('/api/v1/auth/reset-password').send({ token: 'irrelevant', password: 'weak' }).expect(400);

    expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.VALIDATION_ERROR);
  });
});
