import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';
import { toMoneyString } from '../../common/utils/transform.util';
import { MONEY_PATTERN } from '../../common/validation/patterns';

export class CreatePurchaseOrderItemDto {
  @IsUUID()
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  /**
   * Defaults to the product's current cost price.
   *
   * An override is allowed because suppliers negotiate, and the agreed cost is
   * copied onto the line so a later catalogue change cannot rewrite a past
   * purchase.
   */
  @Matches(MONEY_PATTERN, { message: 'unitCost must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  unitCost?: string;

  /** Taken off this line only, as an amount rather than a percentage. */
  @Matches(MONEY_PATTERN, { message: 'discount must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  discount?: string;
}
