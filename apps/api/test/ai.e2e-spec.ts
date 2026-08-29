import request from 'supertest';
import type { ApiErrorResponse } from '../src/common/interfaces/api-response.interface';
import { UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * RBAC and the "not configured" path for `/ai/ask`. No real Anthropic API
 * call is made anywhere in this suite: the test environment has no
 * ANTHROPIC_API_KEY set (see `apps/api/test/jest-e2e.json` / CI env), so
 * `AiService` never constructs a live client - a request that clears the
 * roles guard reaches `AiService.ask()` and is turned back with a clean 503
 * before anything would try to reach the network, exactly like the RBAC test
 * expects. This mirrors how `billing.e2e-spec.ts` avoids real Stripe network
 * calls by exercising only the parts of the flow that don't need one.
 */
describe('AI (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let managerToken: string;
  let staffToken: string;
  let technicianToken: string;

  function ask(token: string): request.Test {
    return request(context.server).post('/api/v1/ai/ask').set('Authorization', `Bearer ${token}`).send({ question: 'How is revenue this month?' });
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = context.run;

    adminToken = (await signInAs(context, `${label}-ai-admin`, UserRole.ADMIN)).accessToken;
    managerToken = (await signInAs(context, `${label}-ai-mgr`, UserRole.MANAGER)).accessToken;
    staffToken = (await signInAs(context, `${label}-ai-staff`, UserRole.STAFF)).accessToken;
    technicianToken = (await signInAs(context, `${label}-ai-tech`, UserRole.TECHNICIAN)).accessToken;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('rejects an unauthenticated request', async () => {
    await request(context.server).post('/api/v1/ai/ask').send({ question: 'How is revenue?' }).expect(401);
  });

  it('rejects STAFF with 403', async () => {
    const response = await ask(staffToken).expect(403);
    expect((response.body as ApiErrorResponse).code).toBe('FORBIDDEN');
  });

  it('rejects TECHNICIAN with 403', async () => {
    await ask(technicianToken).expect(403);
  });

  it('rejects an empty question with 400', async () => {
    const response = await request(context.server).post('/api/v1/ai/ask').set('Authorization', `Bearer ${adminToken}`).send({ question: '' }).expect(400);
    expect((response.body as ApiErrorResponse).code).toBe('VALIDATION_ERROR');
  });

  it('lets ADMIN through the RBAC gate, failing cleanly (503) with no ANTHROPIC_API_KEY configured', async () => {
    const response = await ask(adminToken).expect(503);
    expect((response.body as ApiErrorResponse).code).toBe('SERVICE_UNAVAILABLE');
  });

  it('lets MANAGER through the RBAC gate, failing cleanly (503) with no ANTHROPIC_API_KEY configured', async () => {
    await ask(managerToken).expect(503);
  });
});
