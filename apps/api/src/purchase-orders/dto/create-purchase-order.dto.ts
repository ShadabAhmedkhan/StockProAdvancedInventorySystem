import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDate, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { toMoneyString, trim } from '../../common/utils/transform.util';
import { MONEY_PATTERN } from '../../common/validation/patterns';
import { CreatePurchaseOrderItemDto } from './create-purchase-order-item.dto';

/** Caps the work one request can ask for; larger orders add lines afterwards. */
const MAX_ITEMS_PER_REQUEST = 100;

export class CreatePurchaseOrderDto {
  @IsUUID()
  supplierId: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  expectedDate?: Date;

  /** Taken off the order as a whole, on top of any per-line discounts. */
  @Matches(MONEY_PATTERN, { message: 'discount must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  discount?: string;

  @Matches(MONEY_PATTERN, { message: 'tax must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  tax?: string;

  @Matches(MONEY_PATTERN, { message: 'shipping must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  shipping?: string;

  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  @IsOptional()
  notes?: string;

  /** Optional: a purchase order may be opened empty and filled line by line. */
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  @IsOptional()
  items?: CreatePurchaseOrderItemDto[];
}
