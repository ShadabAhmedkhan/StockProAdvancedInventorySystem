import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ReturnReason, ReturnStatus } from '../../generated/prisma/enums';

export const RETURN_SORT_FIELDS = ['createdAt', 'completedAt', 'returnNumber', 'refundAmount', 'status'] as const;

export type ReturnSortField = (typeof RETURN_SORT_FIELDS)[number];

export class ReturnQueryDto extends PaginationQueryDto {
  @IsIn(RETURN_SORT_FIELDS)
  @IsOptional()
  sortBy: ReturnSortField = 'createdAt';

  @IsEnum(ReturnStatus)
  @IsOptional()
  status?: ReturnStatus;

  @IsEnum(ReturnReason)
  @IsOptional()
  reason?: ReturnReason;

  @IsUUID()
  @IsOptional()
  orderId?: string;

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

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  completedFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  completedTo?: Date;
}
