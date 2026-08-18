/** Pagination detail merged into `meta` on every list response. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Marker wrapper returned by list endpoints.
 *
 * The response interceptor recognises it and spreads `pagination` into the
 * envelope's `meta`, so a service never has to build the envelope itself and
 * the shape cannot drift between modules.
 */
export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly pagination: PaginationMeta,
  ) {}
}

/** Skip/take pair for a Prisma query. */
export interface PageWindow {
  skip: number;
  take: number;
}

export function pageWindow(page: number, limit: number): PageWindow {
  return { skip: (page - 1) * limit, take: limit };
}

export function paginate<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  return new Paginated(items, {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  });
}
