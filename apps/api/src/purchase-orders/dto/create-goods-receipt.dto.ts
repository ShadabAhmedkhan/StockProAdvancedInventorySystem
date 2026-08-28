import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import { CreateGoodsReceiptItemDto } from './create-goods-receipt-item.dto';

const MAX_ITEMS_PER_REQUEST = 100;

export class CreateGoodsReceiptDto {
  /** The purchase order is taken from the route, so a receipt always lands on
   * the order the caller is already looking at. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ITEMS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceiptItemDto)
  items: CreateGoodsReceiptItemDto[];

  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  @IsOptional()
  note?: string;
}
