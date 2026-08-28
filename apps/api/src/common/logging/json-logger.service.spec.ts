import { enterRequestIdContext } from './request-id-context';
import { JsonLogger } from './json-logger.service';

function capture(stream: 'stdout' | 'stderr', fn: () => void): Record<string, unknown>[] {
  const target = stream === 'stdout' ? process.stdout : process.stderr;
  const written: string[] = [];
  const spy = jest.spyOn(target, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });

  fn();
  spy.mockRestore();

  return written.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('JsonLogger', () => {
  it('writes one JSON object per line with the standard fields', () => {
    const logger = new JsonLogger(['log']);

    const [line] = capture('stdout', () => {
      logger.log('server started', 'Bootstrap');
    });

    expect(line).toMatchObject({ level: 'log', message: 'server started', context: 'Bootstrap', pid: process.pid });
    expect(typeof line?.timestamp).toBe('string');
    expect(Date.parse(line?.timestamp as string)).not.toBeNaN();
  });

  it('drops a level that was not enabled', () => {
    const logger = new JsonLogger(['warn', 'error']);

    const lines = capture('stdout', () => {
      logger.debug('should not appear', 'Ctx');
    });

    expect(lines).toHaveLength(0);
  });

  it('correlates a log line with the request in scope via AsyncLocalStorage', () => {
    const logger = new JsonLogger(['log']);

    enterRequestIdContext('req-abc-123');
    const [line] = capture('stdout', () => {
      logger.log('inside a request', 'OrdersService');
    });

    expect(line?.requestId).toBe('req-abc-123');
  });

  it('carries no requestId outside of any request', () => {
    const logger = new JsonLogger(['log']);

    const [line] = capture('stdout', () => {
      logger.log('outside a request', 'Bootstrap');
    });

    expect(line).not.toHaveProperty('requestId');
  });

  it('routes error and fatal to stderr, everything else to stdout', () => {
    const logger = new JsonLogger(['log', 'error', 'fatal']);

    const stderrLines = capture('stderr', () => {
      logger.error('boom');
      logger.fatal('worse');
    });
    const stdoutLines = capture('stdout', () => {
      logger.log('fine');
    });

    expect(stderrLines).toHaveLength(2);
    expect(stdoutLines).toHaveLength(1);
  });

  it('treats a two-optional-arg error() call as (trace, context), matching a thrown exception', () => {
    const logger = new JsonLogger(['error']);

    const [line] = capture('stderr', () => {
      logger.error('request failed', 'Error: boom\n    at Foo', 'OrdersService');
    });

    expect(line).toMatchObject({ message: 'request failed', trace: 'Error: boom\n    at Foo', context: 'OrdersService' });
  });

  it('treats a single-optional-arg error() call as (context), matching a hand-written log', () => {
    const logger = new JsonLogger(['error']);

    const [line] = capture('stderr', () => {
      logger.error('something went wrong', 'OrdersService');
    });

    expect(line).toMatchObject({ message: 'something went wrong', context: 'OrdersService' });
    expect(line).not.toHaveProperty('trace');
  });

  it('serialises a non-string message rather than throwing', () => {
    const logger = new JsonLogger(['log']);

    const [line] = capture('stdout', () => {
      logger.log({ userId: 'u1', action: 'created' });
    });

    expect(line?.message).toBe('{"userId":"u1","action":"created"}');
  });

  it('reacts to setLogLevels the same way a fresh instance would', () => {
    const logger = new JsonLogger(['log']);
    logger.setLogLevels(['error']);

    const dropped = capture('stdout', () => {
      logger.log('should be silent now');
    });
    const kept = capture('stderr', () => {
      logger.error('still audible');
    });

    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });
});
