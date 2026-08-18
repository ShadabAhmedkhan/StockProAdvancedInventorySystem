import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toBoolean, toMoneyString } from '../../common/utils/transform.util';
import { MONEY_PATTERN } from '../../common/validation/patterns';

/**
 * Columns a client may order by. An explicit whitelist, not an open column
 * name: `orderBy` built from raw input lets a caller sort by anything the
 * table holds and read it back one comparison at a time.
 */
export const PRODUCT_SORT_FIELDS = ['createdAt', 'updatedAt', 'sku', 'name', 'costPrice', 'sellingPrice', 'minimumStock'] as const;

export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

export class ProductQueryDto extends PaginationQueryDto {
  @IsIn(PRODUCT_SORT_FIELDS)
  @IsOptional()
  sortBy: ProductSortField = 'createdAt';

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  brandId?: string;

  /** Filters on the catalogue flag, not on stock level. */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  includeDeleted = false;

  /** Bounds on the selling price, as exact decimal strings. */
  @Matches(MONEY_PATTERN, { message: 'minPrice must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  minPrice?: string;

  @Matches(MONEY_PATTERN, { message: 'maxPrice must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  maxPrice?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  createdFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  createdTo?: Date;
}
