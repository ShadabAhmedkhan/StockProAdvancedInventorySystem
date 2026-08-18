import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { trim } from '../utils/transform.util';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;

/** Caps the cost of a single request; clients page rather than dump the table. */
export const MAX_LIMIT = 100;

export type SortOrder = 'asc' | 'desc';

/**
 * Query parameters shared by every list endpoint.
 *
 * `sortBy` is deliberately absent: each module declares its own whitelist of
 * sortable columns, because accepting an arbitrary column name would hand
 * clients a way to probe and order by data they are not allowed to read.
 */
export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = DEFAULT_PAGE;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  @IsOptional()
  limit: number = DEFAULT_LIMIT;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder: SortOrder = 'desc';

  /** Free-text search. Each module decides which columns it applies to. */
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  @IsOptional()
  search?: string;
}
