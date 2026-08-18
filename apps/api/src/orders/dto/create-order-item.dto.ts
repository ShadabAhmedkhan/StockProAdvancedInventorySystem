import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';
import { toMoneyString } from '../../common/utils/transform.util';
import { MONEY_PATTERN } from '../../common/validation/patterns';

export class CreateOrderItemDto {
  @IsUUID()
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  /**
   * Defaults to the product's current selling price.
   *
   * An override is allowed because shops negotiate, and the agreed price is
   * copied onto the line so a later price change cannot rewrite a past sale.
   */
  @Matches(MONEY_PATTERN, { message: 'unitPrice must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  unitPrice?: string;

  /** Taken off this line only, as an amount rather than a percentage. */
  @Matches(MONEY_PATTERN, { message: 'discount must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  discount?: string;
}
