import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { toBoolean } from '../../common/utils/transform.util';

export class CreateReturnItemDto {
  /** The order line the goods came from, so the refund matches what was charged. */
  @IsUUID()
  orderItemId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  /**
   * Whether the goods are fit to sell again.
   *
   * False for anything that comes back broken: the customer is still credited,
   * but the units are written off rather than put back on the shelf, so the
   * ledger never claims stock the shop cannot sell.
   */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  restock = true;
}
