import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import type { ApiResponse } from '../interfaces/api-response.interface';
import { Paginated } from '../pagination/paginated';

/**
 * Wraps every successful controller result in the `{ data, meta }` envelope.
 *
 * A handler that returns {@link Paginated} has its page detail spread into
 * `meta` and its items unwrapped into `data`, so list endpoints never build the
 * envelope themselves and the shape cannot drift between modules.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T | Paginated<T>, ApiResponse<T | T[]>> {
  intercept(context: ExecutionContext, next: CallHandler<T | Paginated<T>>): Observable<ApiResponse<T | T[]>> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      map((payload) => {
        const meta = { requestId: request.requestId, timestamp: new Date().toISOString() };

        return payload instanceof Paginated ? { data: payload.items, meta: { ...meta, ...payload.pagination } } : { data: payload, meta };
      }),
    );
  }
}
