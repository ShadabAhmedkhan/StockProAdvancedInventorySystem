import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StockTransferStatus } from '../../generated/prisma/enums';

export const STOCK_TRANSFER_SORT_FIELDS = ['createdAt', 'transferNumber', 'status'] as const;

export type StockTransferSortField = (typeof STOCK_TRANSFER_SORT_FIELDS)[number];

export class StockTransferQueryDto extends PaginationQueryDto {
  @IsIn(STOCK_TRANSFER_SORT_FIELDS)
  @IsOptional()
  sortBy: StockTransferSortField = 'createdAt';

  @IsEnum(StockTransferStatus)
  @IsOptional()
  status?: StockTransferStatus;

  @IsUUID()
  @IsOptional()
  sourceLocationId?: string;

  @IsUUID()
  @IsOptional()
  destinationLocationId?: string;
}
