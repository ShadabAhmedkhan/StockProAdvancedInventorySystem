import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '../constants/api.constants';
import { requestIdMiddleware } from './request-id.middleware';

interface Harness {
  request: Request;
  response: Response;
  next: NextFunction;
  setHeader: jest.Mock;
}

function createHarness(incomingHeader?: string): Harness {
  const setHeader = jest.fn();
  const request = {
    header: (name: string): string | undefined => (name === REQUEST_ID_HEADER ? incomingHeader : undefined),
  } as unknown as Request;
  const response = { setHeader } as unknown as Response;

  return { request, response, next: jest.fn(), setHeader };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('requestIdMiddleware', () => {
  it('generates a UUID when the client sends no correlation header', () => {
    const { request, response, next, setHeader } = createHarness();

    requestIdMiddleware(request, response, next);

    expect(request.requestId).toMatch(UUID_PATTERN);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, request.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses a well-formed client-supplied id so callers can correlate their own logs', () => {
    const { request, response, next } = createHarness('client-req-000123');

    requestIdMiddleware(request, response, next);

    expect(request.requestId).toBe('client-req-000123');
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['containing a newline', `abcdefgh\ninjected`],
    ['containing a space', 'abcd efgh'],
    ['empty', ''],
  ])('replaces an id that is %s', (_label, header: string) => {
    const { request, response, next } = createHarness(header);

    requestIdMiddleware(request, response, next);

    expect(request.requestId).not.toBe(header);
    expect(request.requestId).toMatch(UUID_PATTERN);
  });
});
