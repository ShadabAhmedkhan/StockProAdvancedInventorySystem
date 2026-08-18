import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import type { AuthResult } from '../../src/auth/dto/auth-response.dto';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import { appConfig, type AppConfiguration } from '../../src/config/app.config';
import { REFRESH_COOKIE_NAME } from '../../src/config/jwt.config';
import type { UserRole } from '../../src/generated/prisma/enums';
import { PrismaService } from '../../src/prisma/prisma.service';

export const TEST_PASSWORD = 'CorrectHorse1';

export interface TestApp {
  app: INestApplication;
  server: Server;
  prisma: PrismaService;
  /** Unique to this application instance, so a re-run never collides. */
  run: string;
  /** Ids created through the API, deleted by {@link closeTestApp}. */
  createdUserIds: string[];
  /** Extra teardown steps, run before the users are removed. */
  cleanup: (() => Promise<void>)[];
}

export interface TestAppOptions {
  /**
   * Raises the global rate limit for this application instance.
   *
   * Only for suites that put through far more requests than one person could:
   * the concurrency tests, which are measuring database behaviour rather than
   * the throttler, and the workflow suites, which compress hours of counter
   * traffic into a few seconds. The limiter keeps its production defaults
   * everywhere else and has its own dedicated test.
   */
  throttleLimit?: number;
}

/**
 * Builds a fully configured application for one spec file.
 *
 * Each file gets its own instance deliberately: the throttler keeps its
 * counters on the application, so per-file apps let credential endpoints keep
 * production-realistic rate limits without one suite starving another.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const previousLimit = process.env.THROTTLE_LIMIT;
  if (options.throttleLimit !== undefined) {
    process.env.THROTTLE_LIMIT = String(options.throttleLimit);
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  // The application has read its configuration by now, so the environment can
  // go back to normal for whichever suite runs next in this worker.
  if (options.throttleLimit !== undefined) {
    if (previousLimit === undefined) {
      delete process.env.THROTTLE_LIMIT;
    } else {
      process.env.THROTTLE_LIMIT = previousLimit;
    }
  }

  const app = moduleRef.createNestApplication();
  configureApp(app, app.get<AppConfiguration>(appConfig.KEY));
  await app.init();

  return {
    app,
    server: app.getHttpServer() as Server,
    prisma: app.get(PrismaService),
    run: randomUUID().slice(0, 8),
    createdUserIds: [],
    cleanup: [],
  };
}

export async function closeTestApp(context: TestApp): Promise<void> {
  for (const step of context.cleanup) {
    await step();
  }

  if (context.createdUserIds.length > 0) {
    await context.prisma.refreshToken.deleteMany({ where: { userId: { in: context.createdUserIds } } });
    await context.prisma.user.deleteMany({ where: { id: { in: context.createdUserIds } } });
  }

  await context.app.close();
}

export function emailFor(context: TestApp, label: string): string {
  return `e2e-${label}-${context.run}@stockpro.test`;
}

export interface RegisteredUser {
  id: string;
  email: string;
  accessToken: string;
  refreshCookie: string;
}

/** Registers through the public endpoint and tracks the row for cleanup. */
export async function registerUser(context: TestApp, label: string): Promise<RegisteredUser> {
  const email = emailFor(context, label);

  const response = await request(context.server)
    .post('/api/v1/auth/register')
    .send({ firstName: 'Test', lastName: label, email, password: TEST_PASSWORD })
    .expect(201);

  const body = response.body as ApiResponse<AuthResult>;
  context.createdUserIds.push(body.data.user.id);

  return {
    id: body.data.user.id,
    email,
    accessToken: body.data.accessToken,
    refreshCookie: refreshCookie(response) ?? '',
  };
}

export function refreshCookie(response: request.Response): string | undefined {
  // superagent types the header bag as `any`; narrow it once here.
  const header: unknown = response.headers['set-cookie'];
  const values = Array.isArray(header) ? (header as unknown[]) : [header];
  const cookies = values.filter((value): value is string => typeof value === 'string');

  return cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

export function cookieValue(cookie: string): string {
  return cookie.split(';')[0]?.split('=')[1] ?? '';
}

/**
 * Registers a user, gives them `role`, and returns a session whose access
 * token actually carries that role.
 *
 * Self-registration always produces STAFF, and the role travels in the token,
 * so a promotion is only visible after a fresh sign-in. Anything other than
 * STAFF therefore costs one login against the five-per-minute allowance.
 */
export async function signInAs(context: TestApp, label: string, role: UserRole): Promise<RegisteredUser> {
  const user = await registerUser(context, label);

  if (role === 'STAFF') {
    return user;
  }

  await context.prisma.user.update({ where: { id: user.id }, data: { role } });

  const login = await request(context.server).post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
  const body = login.body as ApiResponse<AuthResult>;

  return { ...user, accessToken: body.data.accessToken, refreshCookie: refreshCookie(login) ?? user.refreshCookie };
}
