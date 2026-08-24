import { ApiError } from './api-client';

/** Prefers the first field-validation constraint, since it's more actionable than the generic message. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const firstFieldError = error.body.errors?.[0]?.constraints[0];
    return firstFieldError ?? error.body.message;
  }
  return 'Something went wrong. Please try again.';
}
