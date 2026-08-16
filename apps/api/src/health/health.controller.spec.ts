import { Test } from '@nestjs/testing';
import { HealthCheckService, MemoryHealthIndicator, type HealthCheckResult, type HealthIndicatorFunction } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let registeredIndicators: HealthIndicatorFunction[] | undefined;
  let check: jest.Mock;
  let checkHeap: jest.Mock;
  let checkRSS: jest.Mock;

  const healthyResult: HealthCheckResult = {
    status: 'ok',
    info: { memory_heap: { status: 'up' }, memory_rss: { status: 'up' } },
    error: {},
    details: { memory_heap: { status: 'up' }, memory_rss: { status: 'up' } },
  };

  beforeEach(async () => {
    registeredIndicators = undefined;
    check = jest.fn((indicators: HealthIndicatorFunction[]) => {
      registeredIndicators = indicators;
      return Promise.resolve(healthyResult);
    });
    checkHeap = jest.fn(() => Promise.resolve({ memory_heap: { status: 'up' } }));
    checkRSS = jest.fn(() => Promise.resolve({ memory_rss: { status: 'up' } }));

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check } },
        { provide: MemoryHealthIndicator, useValue: { checkHeap, checkRSS } },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('runs the heap and RSS indicators with the configured limits', async () => {
    await expect(controller.check()).resolves.toEqual(healthyResult);

    expect(registeredIndicators).toHaveLength(2);
    await Promise.all((registeredIndicators ?? []).map(async (indicator) => await indicator()));

    expect(checkHeap).toHaveBeenCalledWith('memory_heap', 512 * 1024 * 1024);
    expect(checkRSS).toHaveBeenCalledWith('memory_rss', 1024 * 1024 * 1024);
  });

  it('reports liveness without touching any indicator', () => {
    const result = controller.live();

    expect(result.status).toBe('ok');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.timestamp)).not.toBeNaN();
    expect(check).not.toHaveBeenCalled();
  });
});
