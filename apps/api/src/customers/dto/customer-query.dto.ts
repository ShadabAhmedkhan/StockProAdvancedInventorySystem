import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toBoolean } from '../../common/utils/transform.util';

/**
 * Columns a client may order by. An explicit whitelist, not an open column
 * name: `orderBy` built from raw input lets a caller sort by anything the
 * table holds and read it back one comparison at a time.
 */
export const CUSTOMER_SORT_FIELDS = ['createdAt', 'updatedAt', 'customerCode', 'firstName', 'lastName', 'phone', 'email'] as const;

export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export class CustomerQueryDto extends PaginationQueryDto {
  @IsIn(CUSTOMER_SORT_FIELDS)
  @IsOptional()
  sortBy: CustomerSortField = 'createdAt';

  /** Soft-deleted customers are hidden unless explicitly asked for. */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  includeDeleted = false;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  createdFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  createdTo?: Date;
}
