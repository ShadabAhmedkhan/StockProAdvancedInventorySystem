import { Test } from '@nestjs/testing';
import { HealthCheckService, MemoryHealthIndicator, PrismaHealthIndicator, type HealthCheckResult, type HealthIndicatorFunction } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let registeredIndicators: HealthIndicatorFunction[] | undefined;
  let check: jest.Mock;
  let pingCheck: jest.Mock;
  let checkHeap: jest.Mock;
  let checkRSS: jest.Mock;

  const healthyResult: HealthCheckResult = {
    status: 'ok',
    info: { database: { status: 'up' }, memory_heap: { status: 'up' }, memory_rss: { status: 'up' } },
    error: {},
    details: { database: { status: 'up' }, memory_heap: { status: 'up' }, memory_rss: { status: 'up' } },
  };

  beforeEach(async () => {
    registeredIndicators = undefined;
    check = jest.fn((indicators: HealthIndicatorFunction[]) => {
      registeredIndicators = indicators;
      return Promise.resolve(healthyResult);
    });
    pingCheck = jest.fn(() => Promise.resolve({ database: { status: 'up' } }));
    checkHeap = jest.fn(() => Promise.resolve({ memory_heap: { status: 'up' } }));
    checkRSS = jest.fn(() => Promise.resolve({ memory_rss: { status: 'up' } }));

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check } },
        { provide: MemoryHealthIndicator, useValue: { checkHeap, checkRSS } },
        { provide: PrismaHealthIndicator, useValue: { pingCheck } },
        // The controller only forwards the client to the indicator, so a
        // stand-in keeps this a unit test; the real connection is covered by
        // test/database.e2e-spec.ts.
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('checks the database first, then heap and RSS', async () => {
    await expect(controller.check()).resolves.toEqual(healthyResult);

    expect(registeredIndicators).toHaveLength(3);
    await Promise.all((registeredIndicators ?? []).map(async (indicator) => await indicator()));

    expect(pingCheck).toHaveBeenCalledWith('database', expect.anything(), { timeout: 1500 });
    expect(checkHeap).toHaveBeenCalledWith('memory_heap', 512 * 1024 * 1024);
    expect(checkRSS).toHaveBeenCalledWith('memory_rss', 1024 * 1024 * 1024);
  });

  it('reports liveness without touching any indicator', () => {
    const result = controller.live();

    expect(result.status).toBe('ok');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.timestamp)).not.toBeNaN();
    expect(check).not.toHaveBeenCalled();
    expect(pingCheck).not.toHaveBeenCalled();
  });
});
