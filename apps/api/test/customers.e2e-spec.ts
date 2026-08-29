import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import type { Customer } from '../src/generated/prisma/client';
import { PaymentMethod, RepairStatus, StockMovementType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

interface Identified {
  id: string;
}

function body<T>(response: { body: ApiResponse<T> }): T {
  return response.body.data;
}

describe('Customers (e2e)', () => {
  let context: TestApp;
  let prefix: string;
  let adminToken: string;
  let managerToken: string;
  let staffToken: string;
  let technicianToken: string;

  /** Codes are namespaced per run so a re-run never collides, and are cleaned up afterwards. */
  function code(suffix: string): string {
    return `${prefix}-${suffix}`;
  }

  async function createCustomer(token: string, body: Record<string, unknown>): Promise<ApiResponse<Customer>> {
    const response = await request(context.server).post('/api/v1/customers').set('Authorization', `Bearer ${token}`).send(body).expect(201);
    return response.body as ApiResponse<Customer>;
  }

  beforeAll(async () => {
    context = await createTestApp();
    prefix = `C${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const customerIds = (await context.prisma.customer.findMany({ where: { customerCode: { startsWith: prefix } }, select: { id: true } })).map((c) => c.id);
      await context.prisma.customerNote.deleteMany({ where: { customerId: { in: customerIds } } });
      await context.prisma.customerAddress.deleteMany({ where: { customerId: { in: customerIds } } });
      await context.prisma.financialTransaction.deleteMany({ where: { createdById: { in: context.createdUserIds } } });
      await context.prisma.payment.deleteMany({ where: { OR: [{ order: { customerId: { in: customerIds } } }, { repair: { customerId: { in: customerIds } } }] } });
      await context.prisma.repair.deleteMany({ where: { customerId: { in: customerIds } } });
      await context.prisma.order.deleteMany({ where: { customerId: { in: customerIds } } });
      await context.prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: prefix } } } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: prefix } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: prefix } } });
      await context.prisma.customer.deleteMany({ where: { customerCode: { startsWith: prefix } } });
    });

    // One founding sign-in; everyone else joins that same organization as a teammate.
    adminToken = (await signInAs(context, 'cust-admin', UserRole.ADMIN)).accessToken;
    managerToken = (await inviteTeammate(context, adminToken, 'cust-manager', UserRole.MANAGER)).accessToken;
    technicianToken = (await inviteTeammate(context, adminToken, 'cust-tech', UserRole.TECHNICIAN)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'cust-staff', UserRole.STAFF)).accessToken;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('access control', () => {
    it('refuses an unauthenticated caller', async () => {
      const response = await request(context.server).get('/api/v1/customers').expect(401);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it('lets a technician read, because a repair needs the customer contact', async () => {
      await request(context.server).get('/api/v1/customers').set('Authorization', `Bearer ${technicianToken}`).expect(200);
    });

    it('refuses a technician from creating a customer', async () => {
      const response = await request(context.server)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ customerCode: code('T1'), firstName: 'No', lastName: 'Way', phone: '+15550999' })
        .expect(403);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.FORBIDDEN);
    });

    it('refuses staff from deleting a customer', async () => {
      const created = await createCustomer(staffToken, { customerCode: code('S1'), firstName: 'Staff', lastName: 'Made', phone: '+15550111' });

      await request(context.server).delete(`/api/v1/customers/${created.data.id}`).set('Authorization', `Bearer ${staffToken}`).expect(403);
    });
  });

  describe('POST /customers', () => {
    it('creates a customer and normalises the input', async () => {
      const body = await createCustomer(adminToken, {
        customerCode: code('n1').toLowerCase(),
        firstName: '  Grace  ',
        lastName: ' Mwangi ',
        phone: ' +1 555 0102 ',
        email: '  Grace.Mwangi@Example.TEST ',
      });

      expect(body.data.customerCode).toBe(code('N1'));
      expect(body.data.firstName).toBe('Grace');
      expect(body.data.lastName).toBe('Mwangi');
      expect(body.data.phone).toBe('+1 555 0102');
      expect(body.data.email).toBe('grace.mwangi@example.test');
      expect(body.data.deletedAt).toBeNull();
      expect(body.meta.requestId).toEqual(expect.any(String));
    });

    it('defaults the optional fields to null rather than omitting them', async () => {
      const body = await createCustomer(adminToken, { customerCode: code('N2'), firstName: 'Hugo', lastName: 'Lindqvist', phone: '+15550103' });

      expect(body.data.email).toBeNull();
      expect(body.data.address).toBeNull();
      expect(body.data.notes).toBeNull();
    });

    it('rejects a duplicate code', async () => {
      await createCustomer(adminToken, { customerCode: code('DUP'), firstName: 'First', lastName: 'Owner', phone: '+15550104' });

      const response = await request(context.server)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ customerCode: code('DUP'), firstName: 'Second', lastName: 'Owner', phone: '+15550105' })
        .expect(409);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.CONFLICT);
    });

    it.each([
      ['a code in the wrong shape', { customerCode: 'nope' }, 'customerCode'],
      ['a phone that is not a phone', { phone: 'call me' }, 'phone'],
      ['an email that is not an email', { email: 'not-an-email' }, 'email'],
      ['a blank first name', { firstName: '' }, 'firstName'],
      ['an over-long last name', { lastName: 'x'.repeat(101) }, 'lastName'],
    ])('rejects %s', async (_label, override: Record<string, unknown>, field: string) => {
      const response = await request(context.server)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ customerCode: code('V1'), firstName: 'Valid', lastName: 'Person', phone: '+15550106', ...override })
        .expect(400);

      const body = response.body as ApiErrorResponse;
      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.errors?.map((error) => error.field)).toContain(field);
    });

    it('rejects an unknown property rather than silently dropping it', async () => {
      const response = await request(context.server)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ customerCode: code('V2'), firstName: 'Valid', lastName: 'Person', phone: '+15550107', creditLimit: 99999 })
        .expect(400);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe('GET /customers', () => {
    it('returns a page with its metadata merged into the envelope', async () => {
      const response = await request(context.server).get('/api/v1/customers?page=1&limit=3').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const body = response.body as ApiResponse<Customer[]>;

      expect(body.data.length).toBeLessThanOrEqual(3);
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(3);
      expect(body.meta.total).toBeGreaterThan(0);
      expect(body.meta.totalPages).toBe(Math.ceil((body.meta.total ?? 0) / 3));
    });

    it('pages without overlap', async () => {
      const first = await request(context.server)
        .get('/api/v1/customers?limit=2&page=1&sortBy=customerCode&sortOrder=asc')
        .set('Authorization', `Bearer ${adminToken}`);
      const second = await request(context.server)
        .get('/api/v1/customers?limit=2&page=2&sortBy=customerCode&sortOrder=asc')
        .set('Authorization', `Bearer ${adminToken}`);

      const firstIds = (first.body as ApiResponse<Customer[]>).data.map((row) => row.id);
      const secondIds = (second.body as ApiResponse<Customer[]>).data.map((row) => row.id);

      expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
    });

    it('searches by code fragment', async () => {
      const response = await request(context.server).get(`/api/v1/customers?search=${prefix}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      const body = response.body as ApiResponse<Customer[]>;

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((row) => row.customerCode.startsWith(prefix))).toBe(true);
    });

    it('finds a person by their full name, which spans two columns', async () => {
      await createCustomer(adminToken, { customerCode: code('FULL'), firstName: 'Anika', lastName: 'Sharma', phone: '+15550108' });

      const response = await request(context.server).get('/api/v1/customers?search=Anika%20Sharma').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const body = response.body as ApiResponse<Customer[]>;

      expect(body.data.some((row) => row.customerCode === code('FULL'))).toBe(true);
    });

    it('returns nothing when only one term of a multi-word search matches', async () => {
      const response = await request(context.server)
        .get('/api/v1/customers?search=Anika%20Nonexistent')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((response.body as ApiResponse<Customer[]>).data).toHaveLength(0);
    });

    it('sorts by a whitelisted column', async () => {
      const response = await request(context.server)
        .get(`/api/v1/customers?search=${prefix}&sortBy=customerCode&sortOrder=asc&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const codes = (response.body as ApiResponse<Customer[]>).data.map((row) => row.customerCode);

      expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
    });

    it('filters by a created-date range', async () => {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      const response = await request(context.server).get(`/api/v1/customers?createdFrom=${tomorrow}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

      expect((response.body as ApiResponse<Customer[]>).data).toHaveLength(0);
    });

    it.each([
      ['an unlisted sort column', 'sortBy=notes'],
      ['a limit above the cap', 'limit=1000'],
      ['a zero page', 'page=0'],
      ['a non-boolean includeDeleted', 'includeDeleted=maybe'],
      ['a malformed date', 'createdFrom=yesterday'],
      ['an unknown filter', 'city=Springfield'],
    ])('rejects %s', async (_label, queryString: string) => {
      const response = await request(context.server).get(`/api/v1/customers?${queryString}`).set('Authorization', `Bearer ${adminToken}`).expect(400);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe('GET /customers/:id', () => {
    it('returns a single customer', async () => {
      const created = await createCustomer(adminToken, { customerCode: code('ONE'), firstName: 'Sofia', lastName: 'Marchetti', phone: '+15550109' });

      const response = await request(context.server).get(`/api/v1/customers/${created.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

      expect((response.body as ApiResponse<Customer>).data.customerCode).toBe(code('ONE'));
    });

    it('rejects a malformed id before touching the database', async () => {
      await request(context.server).get('/api/v1/customers/not-a-uuid').set('Authorization', `Bearer ${adminToken}`).expect(400);
    });

    it('returns 404 for an id that does not exist', async () => {
      const response = await request(context.server).get(`/api/v1/customers/${randomUUID()}`).set('Authorization', `Bearer ${adminToken}`).expect(404);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  describe('PATCH /customers/:id', () => {
    it('updates only the supplied fields', async () => {
      const created = await createCustomer(adminToken, {
        customerCode: code('UPD'),
        firstName: 'Yusuf',
        lastName: 'Demir',
        phone: '+15550110',
        address: '77 Copper Way',
      });

      const response = await request(context.server)
        .patch(`/api/v1/customers/${created.data.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ phone: '+15550999' })
        .expect(200);
      const body = response.body as ApiResponse<Customer>;

      expect(body.data.phone).toBe('+15550999');
      expect(body.data.firstName).toBe('Yusuf');
      expect(body.data.address).toBe('77 Copper Way');
    });

    it('rejects a code already held by another customer', async () => {
      const first = await createCustomer(adminToken, { customerCode: code('C1'), firstName: 'One', lastName: 'Person', phone: '+15550112' });
      await createCustomer(adminToken, { customerCode: code('C2'), firstName: 'Two', lastName: 'Person', phone: '+15550113' });

      await request(context.server)
        .patch(`/api/v1/customers/${first.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ customerCode: code('C2') })
        .expect(409);
    });

    it('validates the same rules as creation', async () => {
      const created = await createCustomer(adminToken, { customerCode: code('VAL'), firstName: 'Peter', lastName: 'Nowak', phone: '+15550114' });

      const response = await request(context.server)
        .patch(`/api/v1/customers/${created.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'still-not-an-email' })
        .expect(400);

      expect((response.body as ApiErrorResponse).errors?.map((error) => error.field)).toContain('email');
    });
  });

  describe('soft delete and restore', () => {
    it('hides a deleted customer without destroying the record', async () => {
      const created = await createCustomer(managerToken, { customerCode: code('DEL'), firstName: 'Gone', lastName: 'Away', phone: '+15550115' });

      const deleted = await request(context.server).delete(`/api/v1/customers/${created.data.id}`).set('Authorization', `Bearer ${managerToken}`).expect(200);
      expect((deleted.body as ApiResponse<Customer>).data.deletedAt).not.toBeNull();

      await request(context.server).get(`/api/v1/customers/${created.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(404);

      const listed = await request(context.server)
        .get(`/api/v1/customers?search=${code('DEL')}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((listed.body as ApiResponse<Customer[]>).data).toHaveLength(0);

      // The row is still there, which is what keeps past orders readable.
      const stillStored = await context.prisma.customer.findUnique({ where: { id: created.data.id } });
      expect(stillStored).not.toBeNull();
    });

    it('shows deleted customers when explicitly asked', async () => {
      const created = await createCustomer(managerToken, { customerCode: code('HID'), firstName: 'Hidden', lastName: 'Record', phone: '+15550116' });
      await request(context.server).delete(`/api/v1/customers/${created.data.id}`).set('Authorization', `Bearer ${managerToken}`).expect(200);

      const listed = await request(context.server)
        .get(`/api/v1/customers?search=${code('HID')}&includeDeleted=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((listed.body as ApiResponse<Customer[]>).data).toHaveLength(1);
    });

    it('restores a deleted customer', async () => {
      const created = await createCustomer(managerToken, { customerCode: code('RES'), firstName: 'Back', lastName: 'Again', phone: '+15550117' });
      await request(context.server).delete(`/api/v1/customers/${created.data.id}`).set('Authorization', `Bearer ${managerToken}`).expect(200);

      const restored = await request(context.server)
        .post(`/api/v1/customers/${created.data.id}/restore`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect((restored.body as ApiResponse<Customer>).data.deletedAt).toBeNull();
      await request(context.server).get(`/api/v1/customers/${created.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    });

    it('refuses to restore a customer that was never deleted', async () => {
      const created = await createCustomer(managerToken, { customerCode: code('LIVE'), firstName: 'Still', lastName: 'Here', phone: '+15550118' });

      const response = await request(context.server)
        .post(`/api/v1/customers/${created.data.id}/restore`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(409);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.CONFLICT);
    });

    it('explains that a code is held by a deleted customer instead of a bare conflict', async () => {
      const created = await createCustomer(managerToken, { customerCode: code('TAKEN'), firstName: 'Was', lastName: 'Here', phone: '+15550119' });
      await request(context.server).delete(`/api/v1/customers/${created.data.id}`).set('Authorization', `Bearer ${managerToken}`).expect(200);

      const response = await request(context.server)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ customerCode: code('TAKEN'), firstName: 'New', lastName: 'Person', phone: '+15550120' })
        .expect(409);

      expect((response.body as ApiErrorResponse).message).toMatch(/deleted customer/i);
    });
  });

  describe('CRM: notes, addresses, tags, history and timeline', () => {
    let categoryId: string;
    let crmCustomerId: string;
    let orderId: string;
    let repairId: string;

    async function makeProduct(suffix: string, sellingPrice: string, quantity: number): Promise<string> {
      const created = await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: `${prefix}-${suffix}`, name: `CRM ${suffix}`, categoryId, costPrice: '1.00', sellingPrice })
        .expect(201);
      const productId = body<Identified>(created).id;

      await request(context.server)
        .post('/api/v1/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, type: StockMovementType.PURCHASE, quantity })
        .expect(200);

      return productId;
    }

    beforeAll(async () => {
      const category = await request(context.server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `${prefix}-crm-cat` })
        .expect(201);
      categoryId = body<Identified>(category).id;

      const customer = await createCustomer(adminToken, { customerCode: code('CRM'), firstName: 'Nadia', lastName: 'Costa', phone: '+15550200' });
      crmCustomerId = customer.data.id;

      // A completed order, partly paid: 100.00 owed, 40.00 collected.
      const productId = await makeProduct('P1', '100.00', 5);
      const draft = await request(context.server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ customerId: crmCustomerId, items: [{ productId, quantity: 1 }] })
        .expect(201);
      orderId = body<Identified>(draft).id;
      await request(context.server).post(`/api/v1/orders/${orderId}/confirm`).set('Authorization', `Bearer ${staffToken}`).expect(200);
      await request(context.server).post(`/api/v1/orders/${orderId}/complete`).set('Authorization', `Bearer ${staffToken}`).expect(200);
      await request(context.server)
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '40.00' })
        .expect(201);

      // A completed repair, priced at 60.00, fully paid.
      const repair = await request(context.server)
        .post('/api/v1/repairs')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ customerId: crmCustomerId, deviceType: 'PHONE', problemDescription: 'Cracked screen' })
        .expect(201);
      repairId = body<Identified>(repair).id;
      await request(context.server)
        .post(`/api/v1/repairs/${repairId}/status`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ toStatus: RepairStatus.DIAGNOSING })
        .expect(200);
      await request(context.server)
        .post(`/api/v1/repairs/${repairId}/status`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ toStatus: RepairStatus.APPROVED })
        .expect(200);
      await request(context.server)
        .post(`/api/v1/repairs/${repairId}/status`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ toStatus: RepairStatus.IN_PROGRESS })
        .expect(200);
      await request(context.server)
        .patch(`/api/v1/repairs/${repairId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ finalCost: '60.00' })
        .expect(200);
      await request(context.server)
        .post(`/api/v1/repairs/${repairId}/status`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ toStatus: RepairStatus.COMPLETED })
        .expect(200);
      await request(context.server)
        .post(`/api/v1/repairs/${repairId}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '60.00' })
        .expect(201);
    });

    describe('tags', () => {
      it('sets tags through the ordinary update endpoint', async () => {
        const response = await request(context.server)
          .patch(`/api/v1/customers/${crmCustomerId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ tags: ['vip', 'wholesale'] })
          .expect(200);

        expect((response.body as ApiResponse<Customer>).data.tags).toEqual(['vip', 'wholesale']);
      });
    });

    describe('notes', () => {
      it('adds a note authored by the caller and lists it newest first', async () => {
        await request(context.server)
          .post(`/api/v1/customers/${crmCustomerId}/notes`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send({ body: 'First note' })
          .expect(201);
        await request(context.server)
          .post(`/api/v1/customers/${crmCustomerId}/notes`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send({ body: 'Second note' })
          .expect(201);

        const list = await request(context.server).get(`/api/v1/customers/${crmCustomerId}/notes`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const notes = (list.body as ApiResponse<{ body: string }[]>).data;

        expect(notes[0]?.body).toBe('Second note');
        expect(notes[1]?.body).toBe('First note');
      });

      it('refuses a technician from adding a note', async () => {
        await request(context.server)
          .post(`/api/v1/customers/${crmCustomerId}/notes`)
          .set('Authorization', `Bearer ${technicianToken}`)
          .send({ body: 'Not allowed' })
          .expect(403);
      });
    });

    describe('addresses', () => {
      it('adds an address and later flips the default to a new one', async () => {
        const first = await request(context.server)
          .post(`/api/v1/customers/${crmCustomerId}/addresses`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ label: 'Home', line1: '1 Main St', city: 'Cairo', state: 'Cairo', postalCode: '11511', country: 'Egypt', isDefault: true })
          .expect(201);

        const second = await request(context.server)
          .post(`/api/v1/customers/${crmCustomerId}/addresses`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ label: 'Work', line1: '2 Office Rd', city: 'Giza', state: 'Giza', postalCode: '12511', country: 'Egypt', isDefault: true })
          .expect(201);

        const list = await request(context.server).get(`/api/v1/customers/${crmCustomerId}/addresses`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const addresses = (list.body as ApiResponse<{ id: string; isDefault: boolean }[]>).data;

        expect(addresses.find((a) => a.id === body<Identified>(first).id)?.isDefault).toBe(false);
        expect(addresses.find((a) => a.id === body<Identified>(second).id)?.isDefault).toBe(true);
      });

      it('404s updating and deleting an address that is not this customer\'s', async () => {
        const otherCustomer = await createCustomer(adminToken, { customerCode: code('OTH'), firstName: 'Other', lastName: 'Person', phone: '+15550201' });
        const address = await request(context.server)
          .post(`/api/v1/customers/${otherCustomer.data.id}/addresses`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ label: 'Home', line1: '9 Elsewhere', city: 'Alex', state: 'Alex', postalCode: '21500', country: 'Egypt' })
          .expect(201);

        await request(context.server)
          .patch(`/api/v1/customers/${crmCustomerId}/addresses/${body<Identified>(address).id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ label: 'Hijacked' })
          .expect(404);

        await request(context.server)
          .delete(`/api/v1/customers/${crmCustomerId}/addresses/${body<Identified>(address).id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(404);
      });
    });

    describe('history, outstanding and lifetime value', () => {
      it('lists the real order in purchase history', async () => {
        const response = await request(context.server)
          .get(`/api/v1/customers/${crmCustomerId}/purchase-history`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        const orders = (response.body as ApiResponse<{ id: string; outstanding: string }[]>).data;

        expect(orders.some((o) => o.id === orderId)).toBe(true);
      });

      it('lists the real repair in repair history', async () => {
        const response = await request(context.server)
          .get(`/api/v1/customers/${crmCustomerId}/repair-history`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        const repairs = (response.body as ApiResponse<{ id: string }[]>).data;

        expect(repairs.some((r) => r.id === repairId)).toBe(true);
      });

      it('shows the order as outstanding because it is only partly paid, and no repairs because that one is settled', async () => {
        const response = await request(context.server)
          .get(`/api/v1/customers/${crmCustomerId}/outstanding`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        const outstanding = body<{ orders: { id: string }[]; repairs: { id: string }[] }>(response);

        expect(outstanding.orders.some((o) => o.id === orderId)).toBe(true);
        expect(outstanding.repairs.some((r) => r.id === repairId)).toBe(false);
      });

      it('sums what has actually been collected: 40.00 from the order and 60.00 from the repair', async () => {
        const response = await request(context.server)
          .get(`/api/v1/customers/${crmCustomerId}/lifetime-value`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(body<{ orderRevenue: string; repairRevenue: string; total: string }>(response)).toEqual({
          orderRevenue: '40.00',
          repairRevenue: '60.00',
          total: '100.00',
        });
      });

      it('merges the order, repair and notes into one timeline, newest first', async () => {
        await request(context.server)
          .post(`/api/v1/customers/${crmCustomerId}/notes`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send({ body: 'Timeline marker' })
          .expect(201);

        const response = await request(context.server).get(`/api/v1/customers/${crmCustomerId}/timeline`).set('Authorization', `Bearer ${adminToken}`).expect(200);
        const entries = body<{ type: string; id: string; timestamp: string }[]>(response);

        expect(entries[0]?.type).toBe('NOTE');
        expect(entries.some((e) => e.type === 'ORDER' && e.id === orderId)).toBe(true);
        expect(entries.some((e) => e.type === 'REPAIR' && e.id === repairId)).toBe(true);
        const timestamps = entries.map((e) => new Date(e.timestamp).getTime());
        expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
      });
    });

    describe('tenant isolation', () => {
      it('404s every CRM endpoint for a customer in another organization', async () => {
        const otherOrgToken = (await signInAs(context, `${prefix.toLowerCase()}-other-org`, UserRole.ADMIN)).accessToken;

        await request(context.server).get(`/api/v1/customers/${crmCustomerId}/notes`).set('Authorization', `Bearer ${otherOrgToken}`).expect(404);
        await request(context.server).get(`/api/v1/customers/${crmCustomerId}/addresses`).set('Authorization', `Bearer ${otherOrgToken}`).expect(404);
        await request(context.server).get(`/api/v1/customers/${crmCustomerId}/purchase-history`).set('Authorization', `Bearer ${otherOrgToken}`).expect(404);
        await request(context.server).get(`/api/v1/customers/${crmCustomerId}/repair-history`).set('Authorization', `Bearer ${otherOrgToken}`).expect(404);
        await request(context.server).get(`/api/v1/customers/${crmCustomerId}/outstanding`).set('Authorization', `Bearer ${otherOrgToken}`).expect(404);
        await request(context.server).get(`/api/v1/customers/${crmCustomerId}/lifetime-value`).set('Authorization', `Bearer ${otherOrgToken}`).expect(404);
        await request(context.server).get(`/api/v1/customers/${crmCustomerId}/timeline`).set('Authorization', `Bearer ${otherOrgToken}`).expect(404);
      });
    });
  });
});
