import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PurchaseOrderStatus } from '../../generated/prisma/enums';

export const PURCHASE_ORDER_SORT_FIELDS = ['createdAt', 'expectedDate', 'poNumber', 'total', 'status'] as const;

export type PurchaseOrderSortField = (typeof PURCHASE_ORDER_SORT_FIELDS)[number];

export class PurchaseOrderQueryDto extends PaginationQueryDto {
  @IsIn(PURCHASE_ORDER_SORT_FIELDS)
  @IsOptional()
  sortBy: PurchaseOrderSortField = 'createdAt';

  @IsEnum(PurchaseOrderStatus)
  @IsOptional()
  status?: PurchaseOrderStatus;

  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  createdFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  createdTo?: Date;
}
