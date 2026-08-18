import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toBoolean } from '../../common/utils/transform.util';

/** How a product's stock level compares with its minimum. */
export enum StockStatusFilter {
  ALL = 'ALL',
  OK = 'OK',
  LOW = 'LOW',
  OUT = 'OUT',
}

export const STOCK_SORT_FIELDS = ['sku', 'name', 'quantity', 'availableQuantity', 'minimumStock', 'updatedAt'] as const;

export type StockSortField = (typeof STOCK_SORT_FIELDS)[number];

export class StockQueryDto extends PaginationQueryDto {
  @IsIn(STOCK_SORT_FIELDS)
  @IsOptional()
  sortBy: StockSortField = 'sku';

  @IsIn(['asc', 'desc'])
  @IsOptional()
  override sortOrder: 'asc' | 'desc' = 'asc';

  /**
   * `LOW` is at or below the product's minimum but not yet empty; `OUT` is
   * empty. They are separate because they call for different action: one is a
   * reorder, the other is a lost sale.
   */
  @IsEnum(StockStatusFilter)
  @IsOptional()
  stockStatus: StockStatusFilter = StockStatusFilter.ALL;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  brandId?: string;

  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
