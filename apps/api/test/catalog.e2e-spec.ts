import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import type { Brand, Category } from '../src/generated/prisma/client';
import { UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

describe('Categories and brands (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let staffToken: string;

  /** Names are namespaced per run so a re-run never collides, and are cleaned up afterwards. */
  function name(suffix: string): string {
    return `${label} ${suffix}`;
  }

  async function createCategory(token: string, body: Record<string, unknown>): Promise<ApiResponse<Category>> {
    const response = await request(context.server).post('/api/v1/categories').set('Authorization', `Bearer ${token}`).send(body).expect(201);
    return response.body as ApiResponse<Category>;
  }

  async function createBrand(token: string, body: Record<string, unknown>): Promise<ApiResponse<Brand>> {
    const response = await request(context.server).post('/api/v1/brands').set('Authorization', `Bearer ${token}`).send(body).expect(201);
    return response.body as ApiResponse<Brand>;
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `E2E${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
      await context.prisma.brand.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'cat-admin', UserRole.ADMIN)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'cat-staff', UserRole.STAFF)).accessToken;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('access control', () => {
    it('lets any authenticated user read the catalogue structure', async () => {
      await request(context.server).get('/api/v1/categories').set('Authorization', `Bearer ${staffToken}`).expect(200);
      await request(context.server).get('/api/v1/brands').set('Authorization', `Bearer ${staffToken}`).expect(200);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(context.server).get('/api/v1/categories').expect(401);
      await request(context.server).get('/api/v1/brands').expect(401);
    });

    it('refuses staff from shaping the catalogue', async () => {
      await request(context.server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: name('Denied') })
        .expect(403);
      await request(context.server)
        .post('/api/v1/brands')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: name('Denied') })
        .expect(403);
    });
  });

  describe('POST /categories', () => {
    it('derives the slug from the name', async () => {
      const body = await createCategory(adminToken, { name: name('Spare Parts'), description: 'Screens and batteries' });

      expect(body.data.slug).toBe(`${label.toLowerCase()}-spare-parts`);
      expect(body.data.description).toBe('Screens and batteries');
      expect(body.data.deletedAt).toBeNull();
    });

    it('keeps an explicitly supplied slug', async () => {
      const body = await createCategory(adminToken, { name: name('Pinned'), slug: `${label.toLowerCase()}-pinned-url` });

      expect(body.data.slug).toBe(`${label.toLowerCase()}-pinned-url`);
    });

    it('rejects a duplicate name', async () => {
      await createCategory(adminToken, { name: name('Duplicate') });

      const response = await request(context.server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: name('Duplicate'), slug: `${label.toLowerCase()}-other-slug` })
        .expect(409);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.CONFLICT);
    });

    it('rejects a duplicate slug even under a different name', async () => {
      await createCategory(adminToken, { name: name('SlugOne'), slug: `${label.toLowerCase()}-shared` });

      await request(context.server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: name('SlugTwo'), slug: `${label.toLowerCase()}-shared` })
        .expect(409);
    });

    it('lower-cases a supplied slug rather than rejecting it, as it does for codes and emails', async () => {
      const body = await createCategory(adminToken, { name: name('Normalised'), slug: `${label}-MiXeD-Case` });

      expect(body.data.slug).toBe(`${label.toLowerCase()}-mixed-case`);
    });

    it.each([
      ['a blank name', { name: '' }, 'name'],
      ['an over-long name', { name: 'x'.repeat(121) }, 'name'],
      ['a slug with spaces', { name: 'Valid Name', slug: 'not a slug' }, 'slug'],
      ['a slug with punctuation', { name: 'Valid Name', slug: 'not_a_slug' }, 'slug'],
      ['a slug with doubled hyphens', { name: 'Valid Name', slug: 'not--a--slug' }, 'slug'],
    ])('rejects %s', async (_label, body: Record<string, unknown>, field: string) => {
      const response = await request(context.server).post('/api/v1/categories').set('Authorization', `Bearer ${adminToken}`).send(body).expect(400);

      expect((response.body as ApiErrorResponse).errors?.map((error) => error.field)).toContain(field);
    });

    it('asks for a slug when one cannot be derived from the name', async () => {
      const response = await request(context.server).post('/api/v1/categories').set('Authorization', `Bearer ${adminToken}`).send({ name: '!!!' }).expect(400);

      expect((response.body as ApiErrorResponse).errors?.map((error) => error.field)).toContain('slug');
    });
  });

  describe('GET /categories', () => {
    it('returns a page sorted by name ascending by default', async () => {
      const response = await request(context.server)
        .get(`/api/v1/categories?search=${label}&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as ApiResponse<Category[]>;

      const names = body.data.map((row) => row.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      expect(body.meta.total).toBeGreaterThan(0);
    });

    it('searches name, slug and description', async () => {
      await createCategory(adminToken, { name: name('Findable'), description: 'a very distinctive phrase' });

      const response = await request(context.server)
        .get('/api/v1/categories?search=distinctive%20phrase')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((response.body as ApiResponse<Category[]>).data.some((row) => row.name === name('Findable'))).toBe(true);
    });

    it.each([
      ['an unlisted sort column', 'sortBy=description'],
      ['a limit above the cap', 'limit=1000'],
      ['a non-boolean includeDeleted', 'includeDeleted=maybe'],
    ])('rejects %s', async (_label, queryString: string) => {
      await request(context.server).get(`/api/v1/categories?${queryString}`).set('Authorization', `Bearer ${adminToken}`).expect(400);
    });
  });

  describe('PATCH /categories/:id', () => {
    it('does not re-derive the slug when the name changes, so existing links keep working', async () => {
      const created = await createCategory(adminToken, { name: name('Renamed') });
      const originalSlug = created.data.slug;

      const response = await request(context.server)
        .patch(`/api/v1/categories/${created.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: name('RenamedAgain') })
        .expect(200);
      const body = response.body as ApiResponse<Category>;

      expect(body.data.name).toBe(name('RenamedAgain'));
      expect(body.data.slug).toBe(originalSlug);
    });

    it('changes the slug when it is supplied explicitly', async () => {
      const created = await createCategory(adminToken, { name: name('Reslugged') });

      const response = await request(context.server)
        .patch(`/api/v1/categories/${created.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ slug: `${label.toLowerCase()}-new-slug` })
        .expect(200);

      expect((response.body as ApiResponse<Category>).data.slug).toBe(`${label.toLowerCase()}-new-slug`);
    });

    it('returns 404 for an id that does not exist', async () => {
      await request(context.server)
        .patch(`/api/v1/categories/${randomUUID()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: name('Ghost') })
        .expect(404);
    });
  });

  describe('deleting a category that is in use', () => {
    it('refuses while a live product references it, and allows it once the product is gone', async () => {
      const category = await createCategory(adminToken, { name: name('InUse') });

      const product = await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: `${label}-INUSE-1`, name: 'Blocking product', categoryId: category.data.id, costPrice: '1.00', sellingPrice: '2.00' })
        .expect(201);
      const productId = (product.body as ApiResponse<{ id: string }>).data.id;

      const blocked = await request(context.server).delete(`/api/v1/categories/${category.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(409);
      expect((blocked.body as ApiErrorResponse).message).toMatch(/used by 1 product/);

      await request(context.server).delete(`/api/v1/products/${productId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

      // A soft-deleted product no longer counts as a live reference.
      await request(context.server).delete(`/api/v1/categories/${category.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    });

    it('hides a deleted category and restores it again', async () => {
      const category = await createCategory(adminToken, { name: name('Cycle') });

      await request(context.server).delete(`/api/v1/categories/${category.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      await request(context.server).get(`/api/v1/categories/${category.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(404);

      const listed = await request(context.server)
        .get(`/api/v1/categories?search=${encodeURIComponent(name('Cycle'))}&includeDeleted=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((listed.body as ApiResponse<Category[]>).data).toHaveLength(1);

      await request(context.server).post(`/api/v1/categories/${category.data.id}/restore`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      await request(context.server).get(`/api/v1/categories/${category.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    });
  });

  describe('brands', () => {
    it('derives a slug and rejects duplicates the same way categories do', async () => {
      const created = await createBrand(adminToken, { name: name('Volta Power') });

      expect(created.data.slug).toBe(`${label.toLowerCase()}-volta-power`);

      await request(context.server)
        .post('/api/v1/brands')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: name('Volta Power') })
        .expect(409);
    });

    it('refuses to delete a brand that a live product uses', async () => {
      const category = await createCategory(adminToken, { name: name('BrandCat') });
      const brand = await createBrand(adminToken, { name: name('BrandInUse') });

      await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: `${label}-BRANDED-1`,
          name: 'Branded product',
          categoryId: category.data.id,
          brandId: brand.data.id,
          costPrice: '1.00',
          sellingPrice: '2.00',
        })
        .expect(201);

      const blocked = await request(context.server).delete(`/api/v1/brands/${brand.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(409);
      expect((blocked.body as ApiErrorResponse).message).toMatch(/used by 1 product/);
    });

    it('deletes and restores a brand nothing uses', async () => {
      const brand = await createBrand(adminToken, { name: name('BrandCycle') });

      await request(context.server).delete(`/api/v1/brands/${brand.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      await request(context.server).get(`/api/v1/brands/${brand.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(404);

      await request(context.server).post(`/api/v1/brands/${brand.data.id}/restore`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      await request(context.server).get(`/api/v1/brands/${brand.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    });

    it('refuses to restore a brand that was never deleted', async () => {
      const brand = await createBrand(adminToken, { name: name('BrandLive') });

      await request(context.server).post(`/api/v1/brands/${brand.data.id}/restore`).set('Authorization', `Bearer ${adminToken}`).expect(409);
    });
  });
});
