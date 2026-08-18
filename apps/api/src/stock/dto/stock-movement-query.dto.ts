import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StockMovementType, StockReferenceType } from '../../generated/prisma/enums';

export const MOVEMENT_SORT_FIELDS = ['createdAt', 'quantity'] as const;

export type MovementSortField = (typeof MOVEMENT_SORT_FIELDS)[number];

export class StockMovementQueryDto extends PaginationQueryDto {
  @IsIn(MOVEMENT_SORT_FIELDS)
  @IsOptional()
  sortBy: MovementSortField = 'createdAt';

  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsEnum(StockMovementType)
  @IsOptional()
  type?: StockMovementType;

  @IsEnum(StockReferenceType)
  @IsOptional()
  referenceType?: StockReferenceType;

  @IsUUID()
  @IsOptional()
  createdById?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  createdFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  createdTo?: Date;
}
