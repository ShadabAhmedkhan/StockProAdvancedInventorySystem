import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator, PrismaHealthIndicator, type HealthCheckResult } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

/** Fails readiness before the process is at risk of an out-of-memory kill. */
const HEAP_LIMIT_BYTES = 512 * 1024 * 1024;
const RSS_LIMIT_BYTES = 1024 * 1024 * 1024;

/** A database round trip slower than this means the API cannot serve traffic. */
const DATABASE_TIMEOUT_MS = 1500;

export interface LivenessResult {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

/** Probes are exempt from rate limiting: an orchestrator must never be throttled out. */
@SkipThrottle()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly database: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe - reports whether the API can serve traffic' })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.pingCheck('database', this.prisma, { timeout: DATABASE_TIMEOUT_MS }),
      () => this.memory.checkHeap('memory_heap', HEAP_LIMIT_BYTES),
      () => this.memory.checkRSS('memory_rss', RSS_LIMIT_BYTES),
    ]);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe - reports whether the process is running' })
  live(): LivenessResult {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
