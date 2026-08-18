import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { toMoneyString, trim } from '../../common/utils/transform.util';
import { MONEY_PATTERN } from '../../common/validation/patterns';
import { CreateOrderItemDto } from './create-order-item.dto';

/** Caps the work one request can ask for; larger sales add lines afterwards. */
const MAX_ITEMS_PER_REQUEST = 100;

export class CreateOrderDto {
  /** Absent for a walk-in sale, which has no customer record behind it. */
  @IsUUID()
  @IsOptional()
  customerId?: string;

  /** Taken off the sale as a whole, on top of any per-line discounts. */
  @Matches(MONEY_PATTERN, { message: 'discount must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  discount?: string;

  @Matches(MONEY_PATTERN, { message: 'tax must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  tax?: string;

  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  @IsOptional()
  notes?: string;

  /** Optional: an order may be opened empty and filled line by line. */
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  @IsOptional()
  items?: CreateOrderItemDto[];
}
