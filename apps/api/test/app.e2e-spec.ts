import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { HealthCheckResult } from '@nestjs/terminus';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp, setupSwagger } from '../src/app.setup';
import { REQUEST_ID_HEADER } from '../src/common/constants/api.constants';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import { appConfig, type AppConfiguration } from '../src/config/app.config';
import type { LivenessResult } from '../src/health/health.controller';

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
}

describe('Stock Pro API (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    const config = app.get<AppConfiguration>(appConfig.KEY);
    configureApp(app, config);
    setupSwagger(app);

    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health', () => {
    it('reports readiness inside the standard response envelope', async () => {
      const response = await request(server).get('/api/v1/health').expect(200);
      const body = response.body as ApiResponse<HealthCheckResult>;

      expect(body.data.status).toBe('ok');
      expect(body.data.details).toHaveProperty('memory_heap');
      expect(body.data.details).toHaveProperty('memory_rss');
      expect(body.meta.requestId).toEqual(expect.any(String));
      expect(Date.parse(body.meta.timestamp)).not.toBeNaN();
    });

    it('returns the correlation id both in the envelope and as a response header', async () => {
      const response = await request(server).get('/api/v1/health').expect(200);
      const body = response.body as ApiResponse<HealthCheckResult>;

      expect(response.headers[REQUEST_ID_HEADER]).toBe(body.meta.requestId);
    });

    it('echoes a well-formed client-supplied correlation id', async () => {
      const clientId = 'e2e-correlation-0001';
      const response = await request(server).get('/api/v1/health').set(REQUEST_ID_HEADER, clientId).expect(200);
      const body = response.body as ApiResponse<HealthCheckResult>;

      expect(body.meta.requestId).toBe(clientId);
      expect(response.headers[REQUEST_ID_HEADER]).toBe(clientId);
    });

    it('replaces a malformed client-supplied correlation id', async () => {
      const response = await request(server).get('/api/v1/health').set(REQUEST_ID_HEADER, 'x').expect(200);
      const body = response.body as ApiResponse<HealthCheckResult>;

      expect(body.meta.requestId).not.toBe('x');
    });

    it('serves security headers', async () => {
      const response = await request(server).get('/api/v1/health').expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-dns-prefetch-control']).toBe('off');
      expect(response.headers).not.toHaveProperty('x-powered-by');
    });
  });

  describe('GET /api/v1/health/live', () => {
    it('reports liveness', async () => {
      const response = await request(server).get('/api/v1/health/live').expect(200);
      const body = response.body as ApiResponse<LivenessResult>;

      expect(body.data.status).toBe('ok');
      expect(body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('routing and errors', () => {
    it('serves nothing outside the /api/v1 prefix', async () => {
      await request(server).get('/health').expect(404);
    });

    it('returns the standard error envelope for an unknown route', async () => {
      const response = await request(server).get('/api/v1/not-a-real-route').expect(404);
      const body = response.body as ApiErrorResponse;

      expect(body.statusCode).toBe(404);
      expect(body.code).toBe(ErrorCode.NOT_FOUND);
      expect(body.path).toBe('/api/v1/not-a-real-route');
      expect(body.requestId).toBe(response.headers[REQUEST_ID_HEADER]);
      expect(Date.parse(body.timestamp)).not.toBeNaN();
      expect(body).not.toHaveProperty('stack');
    });

    it('rejects an unsupported method on a known route', async () => {
      const response = await request(server).delete('/api/v1/health').expect(404);
      const body = response.body as ApiErrorResponse;

      expect(body.code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  describe('OpenAPI document', () => {
    it('is published at /api/docs-json with the prefixed routes', async () => {
      const response = await request(server).get('/api/docs-json').expect(200);
      const document = response.body as OpenApiDocument;

      expect(document.info.title).toBe('Stock Pro API');
      expect(Object.keys(document.paths)).toEqual(expect.arrayContaining(['/api/v1/health', '/api/v1/health/live']));
    });

    it('serves the Swagger UI', async () => {
      await request(server).get('/api/docs').expect(200).expect('Content-Type', /html/);
    });
  });
});
