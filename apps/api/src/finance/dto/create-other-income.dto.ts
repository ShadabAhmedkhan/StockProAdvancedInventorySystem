import { Transform, Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { toMoneyString, trim } from '../../common/utils/transform.util';
import { POSITIVE_MONEY_PATTERN } from '../../common/validation/patterns';

/**
 * A manual ledger entry for money that arrived outside a sale, a repair or a
 * return - the only kind of financial transaction a caller may write
 * directly. Every other type is a system-derived record of a payment or an
 * expense that already exists elsewhere, and forging one would let the
 * ledger claim money that no other record backs.
 */
export class CreateOtherIncomeDto {
  @Matches(POSITIVE_MONEY_PATTERN, { message: 'amount must be greater than zero, with at most two decimal places' })
  @Transform(toMoneyString)
  amount: string;

  @IsString()
  @MaxLength(500)
  @Transform(trim)
  description: string;

  /** Defaults to now. Set it when entering income received earlier. */
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  occurredAt?: Date;
}
