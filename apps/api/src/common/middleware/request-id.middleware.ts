import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '../constants/api.constants';

/**
 * Client-supplied ids are echoed back so a caller can correlate its own logs,
 * but only when they are short and alphanumeric. Anything else is replaced:
 * the value ends up in log lines and a response header, so it must never carry
 * control characters or unbounded length.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Assigns `req.requestId` and mirrors it on the response. Must be the first
 * middleware registered, because the response envelope, the exception filter
 * and every log line read it.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  req.requestId = incoming !== undefined && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.requestId);
  next();
}
