import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { toMoneyString, trim } from '../../common/utils/transform.util';
import { POSITIVE_MONEY_PATTERN } from '../../common/validation/patterns';
import { ExpenseCategory } from '../../generated/prisma/enums';

export class CreateExpenseDto {
  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @IsString()
  @MaxLength(500)
  @Transform(trim)
  description: string;

  @Matches(POSITIVE_MONEY_PATTERN, { message: 'amount must be greater than zero, with at most two decimal places' })
  @Transform(toMoneyString)
  amount: string;

  /** Defaults to today. Set it when entering an expense incurred earlier. */
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  expenseDate?: Date;
}
