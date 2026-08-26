import { HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable error identifiers returned in every error response.
 * Clients branch on `code`, never on `message`.
 */
export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  CONFLICT = 'CONFLICT',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  /** The organization's trial has lapsed or its subscription is not active. Distinct from `FORBIDDEN`: the caller may act, their org may not. */
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
}

const STATUS_TO_CODE = new Map<number, ErrorCode>([
  [HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST],
  [HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED],
  [HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN],
  [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
  [HttpStatus.METHOD_NOT_ALLOWED, ErrorCode.METHOD_NOT_ALLOWED],
  [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
  [HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.PAYLOAD_TOO_LARGE],
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE],
  [HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE_ENTITY],
  [HttpStatus.TOO_MANY_REQUESTS, ErrorCode.TOO_MANY_REQUESTS],
  [HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_SERVER_ERROR],
  [HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.SERVICE_UNAVAILABLE],
]);

const KNOWN_CODES = new Set<string>(Object.values(ErrorCode));

/** Lowest status that counts as a server fault. Typed as `number` so it can be
 * compared with raw HTTP statuses without an enum-to-number comparison. */
export const SERVER_ERROR_THRESHOLD: number = HttpStatus.INTERNAL_SERVER_ERROR;

/** Maps an HTTP status to its default error code, falling back by status class. */
export function errorCodeForStatus(status: number): ErrorCode {
  const mapped = STATUS_TO_CODE.get(status);
  if (mapped !== undefined) {
    return mapped;
  }
  return status >= SERVER_ERROR_THRESHOLD ? ErrorCode.INTERNAL_SERVER_ERROR : ErrorCode.BAD_REQUEST;
}

/** Narrows an arbitrary string to a known {@link ErrorCode}. */
export function isErrorCode(value: string): value is ErrorCode {
  return KNOWN_CODES.has(value);
}
