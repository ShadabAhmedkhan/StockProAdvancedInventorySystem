import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { OrderStatus, PaymentStatus } from '../../generated/prisma/enums';

export const ORDER_SORT_FIELDS = ['createdAt', 'completedAt', 'orderNumber', 'total', 'status'] as const;

export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export class OrderQueryDto extends PaginationQueryDto {
  @IsIn(ORDER_SORT_FIELDS)
  @IsOptional()
  sortBy: OrderSortField = 'createdAt';

  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;

  @IsEnum(PaymentStatus)
  @IsOptional()
  paymentStatus?: PaymentStatus;

  @IsUUID()
  @IsOptional()
  customerId?: string;

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

  /** Filters on when the sale actually closed, which is what revenue keys off. */
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  completedFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  completedTo?: Date;
}
