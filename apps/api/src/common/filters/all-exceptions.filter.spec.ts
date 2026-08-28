import { BadRequestException, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode } from '../enums/error-code.enum';
import type { ApiErrorResponse } from '../interfaces/api-response.interface';
import { validationExceptionFactory } from '../pipes/validation-exception.factory';
import { AllExceptionsFilter } from './all-exceptions.filter';

const REQUEST_ID = 'req-0000000001';

/** Drives the filter through a fake Express response and returns what it sent. */
function capture(exception: unknown, exposeInternalErrors = true): ApiErrorResponse {
  let sentBody: ApiErrorResponse | undefined;
  let sentStatus: number | undefined;

  const json = jest.fn((body: ApiErrorResponse) => {
    sentBody = body;
  });
  const status = jest.fn((code: number) => {
    sentStatus = code;
    return { json };
  });

  const request = { requestId: REQUEST_ID, originalUrl: '/api/v1/customers' } as unknown as Request;
  const response = { status } as unknown as Response;
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter(exposeInternalErrors).catch(exception, host);

  if (sentBody === undefined) {
    throw new Error('the filter did not send a response body');
  }
  expect(sentStatus).toBe(sentBody.statusCode);

  return sentBody;
}

describe('AllExceptionsFilter', () => {
  let loggedErrors: jest.SpyInstance;
  let loggedWarnings: jest.SpyInstance;

  beforeEach(() => {
    // The filter logs every failure through the Nest logger; capture it so the
    // test output stays readable and the log content can be asserted.
    loggedErrors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    loggedWarnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs client faults as warnings rather than errors', () => {
    capture(new NotFoundException('Customer not found'));

    expect(loggedWarnings).toHaveBeenCalledTimes(1);
    expect(loggedErrors).not.toHaveBeenCalled();
  });

  it('maps an HTTP exception to its error code and echoes the request id', () => {
    const body = capture(new NotFoundException('Customer not found'));

    expect(body).toEqual({
      statusCode: HttpStatus.NOT_FOUND,
      code: ErrorCode.NOT_FOUND,
      message: 'Customer not found',
      requestId: REQUEST_ID,
      path: '/api/v1/customers',
      timestamp: expect.any(String) as string,
    });
  });

  it('preserves the per-field detail produced by the validation pipe', () => {
    const exception = validationExceptionFactory([
      { property: 'email', constraints: { isEmail: 'email must be an email' }, children: [] },
      { property: 'address', children: [{ property: 'city', constraints: { isNotEmpty: 'city should not be empty' }, children: [] }] },
    ]);

    const body = capture(exception);

    expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.message).toBe('Validation failed');
    expect(body.errors).toEqual([
      { field: 'email', constraints: ['email must be an email'] },
      { field: 'address.city', constraints: ['city should not be empty'] },
    ]);
  });

  it('collapses Nest\u2019s string[] message form into a single line', () => {
    const body = capture(new BadRequestException(['first problem', 'second problem']));

    expect(body.message).toBe('first problem; second problem');
    expect(body.code).toBe(ErrorCode.BAD_REQUEST);
    expect(body.errors).toBeUndefined();
  });

  it('ignores an unrecognised code supplied inside an exception payload', () => {
    const body = capture(new HttpException({ code: 'NOT_A_REAL_CODE', message: 'nope' }, HttpStatus.CONFLICT));

    expect(body.code).toBe(ErrorCode.CONFLICT);
    expect(body.message).toBe('nope');
  });

  it('reports an unhandled error as a 500 and never returns the stack', () => {
    const failure = new Error('connection string is postgres://user:secret@db');
    const body = capture(failure);

    expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
    expect(Object.keys(body)).not.toContain('stack');

    // The stack is for the server log only.
    expect(loggedErrors).toHaveBeenCalledWith(expect.stringContaining(REQUEST_ID), failure.stack);
  });

  it('hides the message of an unhandled error in production', () => {
    const body = capture(new Error('connection string is postgres://user:secret@db'), false);

    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('maps a plain error with a middleware-style status to that status, not 500', () => {
    const failure = Object.assign(new Error('request entity too large'), { status: 413, type: 'entity.too.large' });

    const body = capture(failure);

    expect(body.statusCode).toBe(413);
    expect(body.code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
    expect(body.message).toBe('request entity too large');
  });

  it('reads statusCode as well as status, for middleware that uses the other spelling', () => {
    const failure = Object.assign(new Error('bad request'), { statusCode: 400 });

    const body = capture(failure);

    expect(body.statusCode).toBe(400);
  });

  it('still treats a middleware error as a client fault worth only a warning', () => {
    capture(Object.assign(new Error('request entity too large'), { status: 413 }));

    expect(loggedWarnings).toHaveBeenCalledTimes(1);
    expect(loggedErrors).not.toHaveBeenCalled();
  });

  it('ignores a status outside the 4xx range, so a mislabeled error still falls through to 500', () => {
    const failure = Object.assign(new Error('oops'), { status: 599 });

    const body = capture(failure);

    expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
