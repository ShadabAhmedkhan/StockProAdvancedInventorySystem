import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StockCountStatus } from '../../generated/prisma/enums';

export const STOCK_COUNT_SORT_FIELDS = ['createdAt', 'updatedAt', 'countNumber', 'status'] as const;

export type StockCountSortField = (typeof STOCK_COUNT_SORT_FIELDS)[number];

export class StockCountQueryDto extends PaginationQueryDto {
  @IsIn(STOCK_COUNT_SORT_FIELDS)
  @IsOptional()
  sortBy: StockCountSortField = 'createdAt';

  @IsEnum(StockCountStatus)
  @IsOptional()
  status?: StockCountStatus;

  @IsUUID()
  @IsOptional()
  locationId?: string;
}
