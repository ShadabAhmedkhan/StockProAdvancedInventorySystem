import type { LoggerService, LogLevel } from '@nestjs/common';
import { getCurrentRequestId } from './request-id-context';

interface LogLine {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  requestId?: string;
  trace?: string;
  pid: number;
}

/**
 * One JSON object per line on stdout, so log-aggregation tools (CloudWatch,
 * Loki, Datadog, ...) can parse fields directly instead of regexing Nest's
 * colourised console format. Every call from every `new Logger(context)`
 * across the app is routed here once `app.useLogger(new JsonLogger(...))`
 * runs, per Nest's `Logger.overrideLogger` - this class does not replace
 * those call sites, only how their output is rendered.
 */
export class JsonLogger implements LoggerService {
  private enabled: Set<LogLevel>;

  constructor(levels: LogLevel[]) {
    this.enabled = new Set(levels);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('log', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams);
  }

  /**
   * Nest calls `error(message, trace?, context?)` for a thrown exception, but
   * `error(message, context?)` for a hand-written `logger.error(...)` with no
   * stack - both pass through the same two optional string slots, so which
   * one a given call means is not knowable from the shape alone. Treating the
   * first optional argument as `context` whenever a second one is absent, and
   * as `trace` otherwise, matches Nest's own `ConsoleLogger` behaviour.
   */
  error(message: unknown, ...optionalParams: unknown[]): void {
    if (optionalParams.length >= 2) {
      const [trace, context] = optionalParams;
      this.write('error', message, [], { trace: typeof trace === 'string' ? trace : undefined, context });
      return;
    }
    this.write('error', message, optionalParams);
  }

  setLogLevels(levels: LogLevel[]): void {
    this.enabled = new Set(levels);
  }

  private write(level: LogLevel, message: unknown, optionalParams: unknown[], overrides: { trace?: string; context?: unknown } = {}): void {
    if (!this.enabled.has(level)) {
      return;
    }

    const context = overrides.context ?? optionalParams.find((param) => typeof param === 'string');
    const requestId = getCurrentRequestId();

    const line: LogLine = {
      timestamp: new Date().toISOString(),
      level,
      message: stringifyMessage(message),
      ...(typeof context === 'string' ? { context } : {}),
      ...(requestId === undefined ? {} : { requestId }),
      ...(overrides.trace === undefined ? {} : { trace: overrides.trace }),
      pid: process.pid,
    };

    const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify(line)}\n`);
  }
}

function stringifyMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  if (message instanceof Error) {
    return message.message;
  }
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}
