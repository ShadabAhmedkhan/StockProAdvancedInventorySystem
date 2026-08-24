import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ExpenseCategory } from '../../generated/prisma/enums';

export const EXPENSE_SORT_FIELDS = ['expenseDate', 'amount', 'category', 'createdAt'] as const;

export type ExpenseSortField = (typeof EXPENSE_SORT_FIELDS)[number];

export class ExpenseQueryDto extends PaginationQueryDto {
  @IsIn(EXPENSE_SORT_FIELDS)
  @IsOptional()
  sortBy: ExpenseSortField = 'expenseDate';

  @IsEnum(ExpenseCategory)
  @IsOptional()
  category?: ExpenseCategory;

  @IsUUID()
  @IsOptional()
  createdById?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  expenseFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  expenseTo?: Date;
}
