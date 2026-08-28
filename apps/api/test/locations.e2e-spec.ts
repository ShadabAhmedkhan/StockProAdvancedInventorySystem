import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { LocationType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTeammate, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * Locations CRUD, search, soft-delete/restore, the "default location cannot be
 * deleted" guard, and the access-restriction allow-list (grant/revoke/list,
 * plus ADMIN always bypassing it).
 */
describe('Locations (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;

  interface LocationBody {
    id: string;
    name: string;
    type: LocationType;
    isDefault: boolean;
    deletedAt: string | null;
  }

  function body<T>(response: { body: ApiResponse<T> }): T {
    return response.body.data;
  }

  function post(path: string, payload: Record<string, unknown> = {}): request.Test {
    return request(context.server).post(path).set('Authorization', `Bearer ${adminToken}`).send(payload);
  }

  function get(path: string): request.Test {
    return request(context.server).get(path).set('Authorization', `Bearer ${adminToken}`);
  }

  function del(path: string): request.Test {
    return request(context.server).delete(path).set('Authorization', `Bearer ${adminToken}`);
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `LOC${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      await context.prisma.userLocationAccess.deleteMany({ where: { location: { name: { startsWith: label } } } });
      await context.prisma.location.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'loc-lifecycle', UserRole.ADMIN)).accessToken;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('creates the organization with exactly one default location on registration', async () => {
    const list = await get('/api/v1/locations').expect(200);
    const items = body<LocationBody[]>(list);

    const defaults = items.filter((location) => location.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.name).toBe('Main Location');
  });

  it('runs the create -> update -> soft-delete -> restore lifecycle', async () => {
    const created = await post('/api/v1/locations', { name: `${label} Warehouse`, type: LocationType.WAREHOUSE, address: '1 Dock Rd' }).expect(201);
    const location = body<LocationBody>(created);
    expect(location.type).toBe(LocationType.WAREHOUSE);
    expect(location.isDefault).toBe(false);

    const updated = await request(context.server)
      .patch(`/api/v1/locations/${location.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${label} Warehouse Renamed` })
      .expect(200);
    expect(body<LocationBody>(updated).name).toBe(`${label} Warehouse Renamed`);

    const removed = await del(`/api/v1/locations/${location.id}`).expect(200);
    expect(body<LocationBody>(removed).deletedAt).not.toBeNull();

    // Hidden from the default listing once soft-deleted.
    const afterDelete = await get(`/api/v1/locations?search=${encodeURIComponent(label)}`).expect(200);
    expect(body<LocationBody[]>(afterDelete).some((item) => item.id === location.id)).toBe(false);

    const restored = await post(`/api/v1/locations/${location.id}/restore`).expect(200);
    expect(body<LocationBody>(restored).deletedAt).toBeNull();
  });

  it('finds a location by free-text search', async () => {
    const created = await post('/api/v1/locations', { name: `${label} Searchable Branch`, type: LocationType.STORE }).expect(201);
    const location = body<LocationBody>(created);

    const found = await get(`/api/v1/locations?search=${encodeURIComponent('Searchable Branch')}`).expect(200);
    expect(body<LocationBody[]>(found).some((item) => item.id === location.id)).toBe(true);
  });

  it('refuses to delete the default location', async () => {
    const list = await get('/api/v1/locations').expect(200);
    const defaultLocation = body<LocationBody[]>(list).find((item) => item.isDefault);
    expect(defaultLocation).toBeDefined();

    await del(`/api/v1/locations/${defaultLocation?.id}`).expect(409);
  });

  it('grants and revokes location access, and lists who is restricted', async () => {
    const created = await post('/api/v1/locations', { name: `${label} Access Branch`, type: LocationType.STORE }).expect(201);
    const location = body<LocationBody>(created);

    const teammate = await createTeammate(context, adminToken, 'loc-access-staff', UserRole.STAFF);

    const emptyAccess = await get(`/api/v1/locations/${location.id}/access`).expect(200);
    expect(body<unknown[]>(emptyAccess)).toHaveLength(0);

    const granted = await post(`/api/v1/locations/${location.id}/access`, { userId: teammate.id }).expect(201);
    expect(body<{ userId: string }>(granted).userId).toBe(teammate.id);

    const afterGrant = await get(`/api/v1/locations/${location.id}/access`).expect(200);
    expect(body<{ userId: string }[]>(afterGrant).map((row) => row.userId)).toContain(teammate.id);

    // Granting again is idempotent, not a duplicate row.
    await post(`/api/v1/locations/${location.id}/access`, { userId: teammate.id }).expect(201);
    const stillOne = await get(`/api/v1/locations/${location.id}/access`).expect(200);
    expect(body<unknown[]>(stillOne)).toHaveLength(1);

    await del(`/api/v1/locations/${location.id}/access/${teammate.id}`).expect(200);

    const afterRevoke = await get(`/api/v1/locations/${location.id}/access`).expect(200);
    expect(body<unknown[]>(afterRevoke)).toHaveLength(0);
  });

  it('refuses non-admin/manager writes and non-admin access management', async () => {
    const staff = await createTeammate(context, adminToken, 'loc-staff-writer', UserRole.STAFF);
    const staffLogin = await request(context.server)
      .post('/api/v1/auth/login')
      .send({ email: staff.email, password: 'CorrectHorse1' })
      .expect(200);
    const staffToken = (staffLogin.body as ApiResponse<{ accessToken: string }>).data.accessToken;

    await request(context.server)
      .post('/api/v1/locations')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ name: `${label} Should Not Exist`, type: LocationType.STORE })
      .expect(403);

    const manager = await createTeammate(context, adminToken, 'loc-manager-access', UserRole.MANAGER);
    const managerLogin = await request(context.server)
      .post('/api/v1/auth/login')
      .send({ email: manager.email, password: 'CorrectHorse1' })
      .expect(200);
    const managerToken = (managerLogin.body as ApiResponse<{ accessToken: string }>).data.accessToken;

    const created = await post('/api/v1/locations', { name: `${label} Manager Cannot Grant`, type: LocationType.STORE }).expect(201);
    const location = body<LocationBody>(created);

    // Access management is ADMIN-only, unlike plain create/update which MANAGER may also do.
    await request(context.server)
      .post(`/api/v1/locations/${location.id}/access`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ userId: manager.id })
      .expect(403);
  });
});
