import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toBoolean } from '../../common/utils/transform.util';

/**
 * Columns a client may order by. An explicit whitelist, not an open column
 * name: `orderBy` built from raw input lets a caller sort by anything the
 * table holds and read it back one comparison at a time.
 */
export const LOCATION_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'type'] as const;

export type LocationSortField = (typeof LOCATION_SORT_FIELDS)[number];

export class LocationQueryDto extends PaginationQueryDto {
  @IsIn(LOCATION_SORT_FIELDS)
  @IsOptional()
  sortBy: LocationSortField = 'createdAt';

  /** Soft-deleted locations are hidden unless explicitly asked for. */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  includeDeleted = false;
}
