import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { toMoneyString, trim } from '../utils/transform.util';
import { POSITIVE_MONEY_PATTERN } from '../validation/patterns';
import { PaymentMethod } from '../../generated/prisma/enums';

/**
 * Money received against a document.
 *
 * Nothing here is specific to what is being paid for, so orders, repairs and
 * (in due course) refunds share it; each module supplies its own rule about
 * when a payment may be taken and how much is still owed.
 */
export class CreatePaymentDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  /** Zero is rejected: a payment of nothing is not a payment, and money only
   * travels back out through a return. */
  @Matches(POSITIVE_MONEY_PATTERN, { message: 'amount must be greater than zero, with at most two decimal places' })
  @Transform(toMoneyString)
  amount: string;

  /** External identifier such as a card authorisation or a transfer reference. */
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  @IsOptional()
  reference?: string;

  @IsString()
  @MaxLength(500)
  @Transform(trim)
  @IsOptional()
  note?: string;

  /** Defaults to now. Set it when entering a payment taken earlier. */
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  paidAt?: Date;
}
