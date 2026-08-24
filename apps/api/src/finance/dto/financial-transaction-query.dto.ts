import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TransactionReferenceType, TransactionType } from '../../generated/prisma/enums';

export const TRANSACTION_SORT_FIELDS = ['occurredAt', 'amount', 'type'] as const;

export type TransactionSortField = (typeof TRANSACTION_SORT_FIELDS)[number];

export class FinancialTransactionQueryDto extends PaginationQueryDto {
  @IsIn(TRANSACTION_SORT_FIELDS)
  @IsOptional()
  sortBy: TransactionSortField = 'occurredAt';

  @IsEnum(TransactionType)
  @IsOptional()
  type?: TransactionType;

  @IsEnum(TransactionReferenceType)
  @IsOptional()
  referenceType?: TransactionReferenceType;

  @IsUUID()
  @IsOptional()
  createdById?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  occurredFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  occurredTo?: Date;
}
