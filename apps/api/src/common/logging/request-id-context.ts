import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

/**
 * Puts the current request's id into the async execution context, so any log
 * line written while handling that request can be correlated to it - even
 * from deep inside a service with no direct handle on the request object.
 *
 * Called from `requestIdMiddleware`, which runs before anything else and
 * calls `next()` synchronously, so `enterWith` here reliably covers the rest
 * of that request's handling (unlike a guard, middleware hands off to the
 * next middleware/handler as a direct continuation of the same call stack).
 */
export function enterRequestIdContext(requestId: string): void {
  storage.enterWith(requestId);
}

/** The current request's id, or `undefined` outside of a request (startup, a scheduled job). */
export function getCurrentRequestId(): string | undefined {
  return storage.getStore();
}
