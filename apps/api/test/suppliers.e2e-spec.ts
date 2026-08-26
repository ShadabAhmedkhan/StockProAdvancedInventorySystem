import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import type { Supplier } from '../src/generated/prisma/client';
import { UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

describe('Suppliers (e2e)', () => {
  let context: TestApp;
  let prefix: string;
  let adminToken: string;
  let managerToken: string;
  let staffToken: string;

  /** Codes are namespaced per run so a re-run never collides, and are cleaned up afterwards. */
  function code(suffix: string): string {
    return `${prefix}-${suffix}`;
  }

  async function createSupplier(token: string, body: Record<string, unknown>): Promise<ApiResponse<Supplier>> {
    const response = await request(context.server).post('/api/v1/suppliers').set('Authorization', `Bearer ${token}`).send(body).expect(201);
    return response.body as ApiResponse<Supplier>;
  }

  beforeAll(async () => {
    context = await createTestApp();
    prefix = `S${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      await context.prisma.supplier.deleteMany({ where: { supplierCode: { startsWith: prefix } } });
    });

    // One founding sign-in; everyone else joins that same organization as a teammate.
    adminToken = (await signInAs(context, 'sup-admin', UserRole.ADMIN)).accessToken;
    managerToken = (await inviteTeammate(context, adminToken, 'sup-manager', UserRole.MANAGER)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'sup-staff', UserRole.STAFF)).accessToken;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('access control', () => {
    it('refuses an unauthenticated caller', async () => {
      const response = await request(context.server).get('/api/v1/suppliers').expect(401);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it('lets staff read, because receiving a delivery needs the contact details', async () => {
      await request(context.server).get('/api/v1/suppliers').set('Authorization', `Bearer ${staffToken}`).expect(200);
    });

    it('refuses staff from creating a supplier, which is purchasing master data', async () => {
      const response = await request(context.server)
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ supplierCode: code('S1'), name: 'Not Allowed Ltd', phone: '+15550999' })
        .expect(403);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.FORBIDDEN);
    });

    it('refuses staff from updating or deleting a supplier', async () => {
      const created = await createSupplier(adminToken, { supplierCode: code('S2'), name: 'Managed Only Ltd', phone: '+15550210' });

      await request(context.server)
        .patch(`/api/v1/suppliers/${created.data.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ phone: '+15550211' })
        .expect(403);
      await request(context.server).delete(`/api/v1/suppliers/${created.data.id}`).set('Authorization', `Bearer ${staffToken}`).expect(403);
    });
  });

  describe('POST /suppliers', () => {
    it('creates a supplier and normalises the input', async () => {
      const body = await createSupplier(managerToken, {
        supplierCode: code('n1').toLowerCase(),
        name: '  Meridian Mobile Parts  ',
        contactPerson: ' Samuel Adeyemi ',
        phone: ' +1 555 0201 ',
        email: '  Orders@Meridianparts.TEST ',
      });

      expect(body.data.supplierCode).toBe(code('N1'));
      expect(body.data.name).toBe('Meridian Mobile Parts');
      expect(body.data.contactPerson).toBe('Samuel Adeyemi');
      expect(body.data.phone).toBe('+1 555 0201');
      expect(body.data.email).toBe('orders@meridianparts.test');
      expect(body.data.deletedAt).toBeNull();
      expect(body.meta.requestId).toEqual(expect.any(String));
    });

    it('defaults the optional fields to null rather than omitting them', async () => {
      const body = await createSupplier(adminToken, { supplierCode: code('N2'), name: 'Cobalt Accessories', phone: '+15550202' });

      expect(body.data.contactPerson).toBeNull();
      expect(body.data.email).toBeNull();
      expect(body.data.address).toBeNull();
      expect(body.data.notes).toBeNull();
    });

    it('rejects a duplicate code', async () => {
      await createSupplier(adminToken, { supplierCode: code('DUP'), name: 'First Owner Ltd', phone: '+15550204' });

      const response = await request(context.server)
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ supplierCode: code('DUP'), name: 'Second Owner Ltd', phone: '+15550205' })
        .expect(409);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.CONFLICT);
    });

    it.each([
      ['a code in the wrong shape', { supplierCode: 'nope' }, 'supplierCode'],
      ['a phone that is not a phone', { phone: 'ring us' }, 'phone'],
      ['an email that is not an email', { email: 'not-an-email' }, 'email'],
      ['a blank name', { name: '' }, 'name'],
      ['an over-long name', { name: 'x'.repeat(201) }, 'name'],
      ['an over-long contact person', { contactPerson: 'x'.repeat(151) }, 'contactPerson'],
    ])('rejects %s', async (_label, override: Record<string, unknown>, field: string) => {
      const response = await request(context.server)
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ supplierCode: code('V1'), name: 'Valid Supplier', phone: '+15550206', ...override })
        .expect(400);

      const body = response.body as ApiErrorResponse;
      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.errors?.map((error) => error.field)).toContain(field);
    });

    it('rejects an unknown property rather than silently dropping it', async () => {
      const response = await request(context.server)
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ supplierCode: code('V2'), name: 'Valid Supplier', phone: '+15550207', paymentTerms: 'NET30' })
        .expect(400);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe('GET /suppliers', () => {
    it('returns a page with its metadata merged into the envelope', async () => {
      const response = await request(context.server).get('/api/v1/suppliers?page=1&limit=2').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const body = response.body as ApiResponse<Supplier[]>;

      expect(body.data.length).toBeLessThanOrEqual(2);
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(2);
      expect(body.meta.total).toBeGreaterThan(0);
      expect(body.meta.totalPages).toBe(Math.ceil((body.meta.total ?? 0) / 2));
    });

    it('pages without overlap', async () => {
      const first = await request(context.server)
        .get('/api/v1/suppliers?limit=2&page=1&sortBy=supplierCode&sortOrder=asc')
        .set('Authorization', `Bearer ${adminToken}`);
      const second = await request(context.server)
        .get('/api/v1/suppliers?limit=2&page=2&sortBy=supplierCode&sortOrder=asc')
        .set('Authorization', `Bearer ${adminToken}`);

      const firstIds = (first.body as ApiResponse<Supplier[]>).data.map((row) => row.id);
      const secondIds = (second.body as ApiResponse<Supplier[]>).data.map((row) => row.id);

      expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
    });

    it('searches by code fragment', async () => {
      const response = await request(context.server).get(`/api/v1/suppliers?search=${prefix}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      const body = response.body as ApiResponse<Supplier[]>;

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((row) => row.supplierCode.startsWith(prefix))).toBe(true);
    });

    it('finds a supplier by a term from the name and one from the contact person', async () => {
      await createSupplier(adminToken, { supplierCode: code('SPLIT'), name: 'Vertex Displays', contactPerson: 'Ivan Horvat', phone: '+15550208' });

      const response = await request(context.server).get('/api/v1/suppliers?search=Vertex%20Horvat').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const body = response.body as ApiResponse<Supplier[]>;

      expect(body.data.some((row) => row.supplierCode === code('SPLIT'))).toBe(true);
    });

    it('returns nothing when only one term of a multi-word search matches', async () => {
      const response = await request(context.server)
        .get('/api/v1/suppliers?search=Vertex%20Nonexistent')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((response.body as ApiResponse<Supplier[]>).data).toHaveLength(0);
    });

    it('sorts by a whitelisted column', async () => {
      const response = await request(context.server)
        .get(`/api/v1/suppliers?search=${prefix}&sortBy=supplierCode&sortOrder=asc&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const codes = (response.body as ApiResponse<Supplier[]>).data.map((row) => row.supplierCode);

      expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
    });

    it('filters by a created-date range', async () => {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      const response = await request(context.server).get(`/api/v1/suppliers?createdFrom=${tomorrow}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

      expect((response.body as ApiResponse<Supplier[]>).data).toHaveLength(0);
    });

    it.each([
      ['an unlisted sort column', 'sortBy=notes'],
      ['a limit above the cap', 'limit=1000'],
      ['a zero page', 'page=0'],
      ['a non-boolean includeDeleted', 'includeDeleted=maybe'],
      ['a malformed date', 'createdFrom=yesterday'],
      ['an unknown filter', 'country=NL'],
    ])('rejects %s', async (_label, queryString: string) => {
      const response = await request(context.server).get(`/api/v1/suppliers?${queryString}`).set('Authorization', `Bearer ${adminToken}`).expect(400);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe('GET /suppliers/:id', () => {
    it('returns a single supplier', async () => {
      const created = await createSupplier(adminToken, { supplierCode: code('ONE'), name: 'Single Read Ltd', phone: '+15550209' });

      const response = await request(context.server).get(`/api/v1/suppliers/${created.data.id}`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect((response.body as ApiResponse<Supplier>).data.supplierCode).toBe(code('ONE'));
    });

    it('rejects a malformed id before touching the database', async () => {
      await request(context.server).get('/api/v1/suppliers/not-a-uuid').set('Authorization', `Bearer ${adminToken}`).expect(400);
    });

    it('returns 404 for an id that does not exist', async () => {
      const response = await request(context.server).get(`/api/v1/suppliers/${randomUUID()}`).set('Authorization', `Bearer ${adminToken}`).expect(404);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  describe('PATCH /suppliers/:id', () => {
    it('updates only the supplied fields', async () => {
      const created = await createSupplier(adminToken, {
        supplierCode: code('UPD'),
        name: 'Original Name Ltd',
        contactPerson: 'Mei Lin',
        phone: '+15550212',
        address: '402 Dockside',
      });

      const response = await request(context.server)
        .patch(`/api/v1/suppliers/${created.data.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ phone: '+15550999' })
        .expect(200);
      const body = response.body as ApiResponse<Supplier>;

      expect(body.data.phone).toBe('+15550999');
      expect(body.data.name).toBe('Original Name Ltd');
      expect(body.data.contactPerson).toBe('Mei Lin');
      expect(body.data.address).toBe('402 Dockside');
    });

    it('rejects a code already held by another supplier', async () => {
      const first = await createSupplier(adminToken, { supplierCode: code('C1'), name: 'One Ltd', phone: '+15550213' });
      await createSupplier(adminToken, { supplierCode: code('C2'), name: 'Two Ltd', phone: '+15550214' });

      await request(context.server)
        .patch(`/api/v1/suppliers/${first.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ supplierCode: code('C2') })
        .expect(409);
    });

    it('validates the same rules as creation', async () => {
      const created = await createSupplier(adminToken, { supplierCode: code('VAL'), name: 'Validated Ltd', phone: '+15550215' });

      const response = await request(context.server)
        .patch(`/api/v1/suppliers/${created.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'still-not-an-email' })
        .expect(400);

      expect((response.body as ApiErrorResponse).errors?.map((error) => error.field)).toContain('email');
    });
  });

  describe('soft delete and restore', () => {
    it('hides a deleted supplier without destroying the record', async () => {
      const created = await createSupplier(managerToken, { supplierCode: code('DEL'), name: 'Gone Away Ltd', phone: '+15550216' });

      const deleted = await request(context.server).delete(`/api/v1/suppliers/${created.data.id}`).set('Authorization', `Bearer ${managerToken}`).expect(200);
      expect((deleted.body as ApiResponse<Supplier>).data.deletedAt).not.toBeNull();

      await request(context.server).get(`/api/v1/suppliers/${created.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(404);

      const listed = await request(context.server)
        .get(`/api/v1/suppliers?search=${code('DEL')}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((listed.body as ApiResponse<Supplier[]>).data).toHaveLength(0);

      // The row survives, which is what keeps the provenance of existing stock readable.
      const stillStored = await context.prisma.supplier.findUnique({ where: { id: created.data.id } });
      expect(stillStored).not.toBeNull();
    });

    it('shows deleted suppliers when explicitly asked', async () => {
      const created = await createSupplier(managerToken, { supplierCode: code('HID'), name: 'Hidden Ltd', phone: '+15550217' });
      await request(context.server).delete(`/api/v1/suppliers/${created.data.id}`).set('Authorization', `Bearer ${managerToken}`).expect(200);

      const listed = await request(context.server)
        .get(`/api/v1/suppliers?search=${code('HID')}&includeDeleted=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((listed.body as ApiResponse<Supplier[]>).data).toHaveLength(1);
    });

    it('restores a deleted supplier', async () => {
      const created = await createSupplier(managerToken, { supplierCode: code('RES'), name: 'Back Again Ltd', phone: '+15550218' });
      await request(context.server).delete(`/api/v1/suppliers/${created.data.id}`).set('Authorization', `Bearer ${managerToken}`).expect(200);

      const restored = await request(context.server)
        .post(`/api/v1/suppliers/${created.data.id}/restore`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect((restored.body as ApiResponse<Supplier>).data.deletedAt).toBeNull();
      await request(context.server).get(`/api/v1/suppliers/${created.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    });

    it('refuses to restore a supplier that was never deleted', async () => {
      const created = await createSupplier(managerToken, { supplierCode: code('LIVE'), name: 'Still Here Ltd', phone: '+15550219' });

      const response = await request(context.server)
        .post(`/api/v1/suppliers/${created.data.id}/restore`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(409);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.CONFLICT);
    });

    it('explains that a code is held by a deleted supplier instead of a bare conflict', async () => {
      const created = await createSupplier(managerToken, { supplierCode: code('TAKEN'), name: 'Was Here Ltd', phone: '+15550220' });
      await request(context.server).delete(`/api/v1/suppliers/${created.data.id}`).set('Authorization', `Bearer ${managerToken}`).expect(200);

      const response = await request(context.server)
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ supplierCode: code('TAKEN'), name: 'New Owner Ltd', phone: '+15550221' })
        .expect(409);

      expect((response.body as ApiErrorResponse).message).toMatch(/deleted supplier/i);
    });
  });
});
