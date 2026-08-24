import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaymentMethod, PaymentReferenceType } from '../../generated/prisma/enums';

export const PAYMENT_SORT_FIELDS = ['paidAt', 'amount', 'method'] as const;

export type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];

export class PaymentQueryDto extends PaginationQueryDto {
  @IsIn(PAYMENT_SORT_FIELDS)
  @IsOptional()
  sortBy: PaymentSortField = 'paidAt';

  @IsEnum(PaymentMethod)
  @IsOptional()
  method?: PaymentMethod;

  @IsEnum(PaymentReferenceType)
  @IsOptional()
  referenceType?: PaymentReferenceType;

  @IsUUID()
  @IsOptional()
  createdById?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  paidFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  paidTo?: Date;
}
