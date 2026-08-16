import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode, SERVER_ERROR_THRESHOLD, errorCodeForStatus, isErrorCode } from '../enums/error-code.enum';
import type { ApiErrorResponse, ApiFieldError } from '../interfaces/api-response.interface';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && (value as unknown[]).every((item) => typeof item === 'string');
}

function isApiFieldError(value: unknown): value is ApiFieldError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('field' in value) || !('constraints' in value)) {
    return false;
  }
  return typeof value.field === 'string' && isStringArray(value.constraints);
}

/** Reads `code` from an HttpException payload, ignoring anything unrecognised. */
function readCode(payload: object): ErrorCode | undefined {
  if (!('code' in payload)) {
    return undefined;
  }
  const value = payload.code;
  return typeof value === 'string' && isErrorCode(value) ? value : undefined;
}

/** Reads `message`, collapsing Nest's `string[]` form into a single line. */
function readMessage(payload: object): string | undefined {
  if (!('message' in payload)) {
    return undefined;
  }
  const value = payload.message;
  if (typeof value === 'string') {
    return value;
  }
  if (isStringArray(value) && value.length > 0) {
    return value.join('; ');
  }
  return undefined;
}

/** Reads the per-field validation detail produced by `validationExceptionFactory`. */
function readFieldErrors(payload: object): ApiFieldError[] | undefined {
  if (!('errors' in payload)) {
    return undefined;
  }
  const value = payload.errors;
  if (!Array.isArray(value)) {
    return undefined;
  }
  const fieldErrors = (value as unknown[]).filter(isApiFieldError);
  return fieldErrors.length > 0 ? fieldErrors : undefined;
}

/**
 * Single exit point for every failure, so clients always receive the same
 * error envelope and internals never leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * @param exposeInternalErrors When false (production), the message of an
   * unhandled error is replaced by a generic one. Stacks are never sent to the
   * client in either mode; they are logged server-side only.
   */
  constructor(private readonly exposeInternalErrors: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const body = this.buildErrorResponse(exception, request);
    this.logException(exception, body);

    response.status(body.statusCode).json(body);
  }

  private buildErrorResponse(exception: unknown, request: Request): ApiErrorResponse {
    const requestId = request.requestId;
    const path = request.originalUrl;
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();
      const details =
        typeof payload === 'string'
          ? { code: undefined, message: payload, errors: undefined }
          : { code: readCode(payload), message: readMessage(payload), errors: readFieldErrors(payload) };

      return {
        statusCode,
        code: details.code ?? errorCodeForStatus(statusCode),
        message: details.message ?? exception.message,
        ...(details.errors === undefined ? {} : { errors: details.errors }),
        requestId,
        path,
        timestamp,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: this.exposeInternalErrors && exception instanceof Error ? exception.message : 'Internal server error',
      requestId,
      path,
      timestamp,
    };
  }

  private logException(exception: unknown, body: ApiErrorResponse): void {
    const summary = `${body.requestId} ${String(body.statusCode)} ${body.path} - ${body.message}`;

    if (body.statusCode >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(summary, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(summary);
    }
  }
}
