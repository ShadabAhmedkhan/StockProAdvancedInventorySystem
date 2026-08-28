import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { errorMessage } from './error-message';

describe('errorMessage', () => {
  it('prefers the first field-validation constraint over the generic message', () => {
    const error = new ApiError(400, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: [{ field: 'email', constraints: ['email must be an email'] }],
      requestId: 'req-1',
      path: '/api/v1/customers',
      timestamp: new Date().toISOString(),
    });
    expect(errorMessage(error)).toBe('email must be an email');
  });

  it('falls back to the generic message when there are no field errors', () => {
    const error = new ApiError(409, {
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Customer code already in use',
      requestId: 'req-2',
      path: '/api/v1/customers',
      timestamp: new Date().toISOString(),
    });
    expect(errorMessage(error)).toBe('Customer code already in use');
  });

  it('returns a generic message for a non-ApiError', () => {
    expect(errorMessage(new Error('network down'))).toBe('Something went wrong. Please try again.');
    expect(errorMessage('some string')).toBe('Something went wrong. Please try again.');
  });
});
