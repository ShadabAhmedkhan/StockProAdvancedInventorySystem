import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse } from '../src/common/interfaces/api-response.interface';
import { appConfig, type AppConfiguration } from '../src/config/app.config';

/** Matches the LOGIN_RATE_LIMIT declared on AuthController. */
const LOGIN_ATTEMPTS_ALLOWED = 5;

/**
 * The login rate limiter, in its own file on purpose.
 *
 * The throttler's storage lives on the application instance, so a separate
 * spec file gets a clean counter and can spend the whole budget without
 * starving the rest of the authentication suite.
 */
describe('Login rate limiting (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get<AppConfiguration>(appConfig.KEY));
    await app.init();

    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks further attempts once the per-minute allowance is spent', async () => {
    const credentials = { email: `nobody-${randomUUID().slice(0, 8)}@stockpro.test`, password: 'WrongPassword1' };

    // Failed attempts still count; otherwise a password-spraying script would
    // get unlimited guesses simply by always being wrong.
    for (let attempt = 0; attempt < LOGIN_ATTEMPTS_ALLOWED; attempt += 1) {
      await request(server).post('/api/v1/auth/login').send(credentials).expect(401);
    }

    const blocked = await request(server).post('/api/v1/auth/login').send(credentials).expect(429);
    const body = blocked.body as ApiErrorResponse;

    expect(body.code).toBe(ErrorCode.TOO_MANY_REQUESTS);
    expect(body.requestId).toEqual(expect.any(String));
  });

  it('leaves unrelated endpoints usable while login is blocked', async () => {
    await request(server).get('/api/v1/health/live').expect(200);
  });
});
