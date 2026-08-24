import request from 'supertest';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { SettingValueType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

interface SettingBody {
  id: string;
  key: string;
  value: string;
  valueType: SettingValueType;
  description: string | null;
  parsedValue: unknown;
}

function body<T>(response: { body: ApiResponse<T> }): T {
  return response.body.data;
}

function errorMessage(response: request.Response): string {
  return (response.body as ApiErrorResponse).message;
}

describe('Settings (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let managerToken: string;
  let staffToken: string;

  function as(token: string, method: 'put' | 'delete' | 'get', path: string): request.Test {
    return request(context.server)[method](path).set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `st_${context.run.slice(0, 8)}`;

    context.cleanup.push(async () => {
      await context.prisma.auditLog.deleteMany({ where: { userId: { in: context.createdUserIds } } });
      await context.prisma.setting.deleteMany({ where: { key: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'set-admin', UserRole.ADMIN)).accessToken;
    managerToken = (await signInAs(context, 'set-manager', UserRole.MANAGER)).accessToken;
    staffToken = (await signInAs(context, 'set-staff', UserRole.STAFF)).accessToken;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('creates a setting and decodes its value according to its type', async () => {
    const response = await as(adminToken, 'put', `/api/v1/settings/${label}_threshold`)
      .send({ value: '5', valueType: SettingValueType.NUMBER, description: 'Reorder point' })
      .expect(200);

    const setting = body<SettingBody>(response);
    expect(setting.value).toBe('5');
    expect(setting.parsedValue).toBe(5);
  });

  it('refuses a staff member writing a setting', async () => {
    await as(staffToken, 'put', `/api/v1/settings/${label}_staff_blocked`).send({ value: '1', valueType: SettingValueType.NUMBER }).expect(403);
  });

  it('refuses a manager writing a setting - only an administrator may', async () => {
    await as(managerToken, 'put', `/api/v1/settings/${label}_manager_blocked`).send({ value: '1', valueType: SettingValueType.NUMBER }).expect(403);
  });

  it('lets a manager read settings', async () => {
    await as(managerToken, 'get', '/api/v1/settings').expect(200);
  });

  it('rejects a value that does not match its declared type', async () => {
    const response = await as(adminToken, 'put', `/api/v1/settings/${label}_bad_number`)
      .send({ value: 'not-a-number', valueType: SettingValueType.NUMBER })
      .expect(400);
    expect(errorMessage(response)).toMatch(/validation failed/i);
  });

  it('reads a JSON setting back parsed', async () => {
    await as(adminToken, 'put', `/api/v1/settings/${label}_json`).send({ value: '{"currency":"USD"}', valueType: SettingValueType.JSON }).expect(200);

    const response = await as(adminToken, 'get', `/api/v1/settings/${label}_json`).expect(200);
    expect(body<SettingBody>(response).parsedValue).toEqual({ currency: 'USD' });
  });

  it('replaces the value on a second PUT to the same key, rather than duplicating it', async () => {
    const key = `${label}_replace`;
    await as(adminToken, 'put', `/api/v1/settings/${key}`).send({ value: '1', valueType: SettingValueType.NUMBER }).expect(200);
    await as(adminToken, 'put', `/api/v1/settings/${key}`).send({ value: '2', valueType: SettingValueType.NUMBER }).expect(200);

    const response = await as(adminToken, 'get', `/api/v1/settings/${key}`).expect(200);
    expect(body<SettingBody>(response).value).toBe('2');
  });

  it('404s for a setting that does not exist', async () => {
    await as(adminToken, 'get', `/api/v1/settings/${label}_missing`).expect(404);
  });

  it('removes a setting', async () => {
    const key = `${label}_removable`;
    await as(adminToken, 'put', `/api/v1/settings/${key}`).send({ value: '1', valueType: SettingValueType.NUMBER }).expect(200);

    await as(adminToken, 'delete', `/api/v1/settings/${key}`).expect(200);

    await as(adminToken, 'get', `/api/v1/settings/${key}`).expect(404);
  });

  it('refuses a staff member removing a setting', async () => {
    const key = `${label}_undeletable`;
    await as(adminToken, 'put', `/api/v1/settings/${key}`).send({ value: '1', valueType: SettingValueType.NUMBER }).expect(200);

    await as(staffToken, 'delete', `/api/v1/settings/${key}`).expect(403);
  });
});
