import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import { CreateStockTransferItemDto } from './create-stock-transfer-item.dto';

/** Caps the work one request can ask for; larger transfers add lines afterwards. */
const MAX_ITEMS_PER_REQUEST = 100;

export class CreateStockTransferDto {
  @IsUUID()
  sourceLocationId: string;

  @IsUUID()
  destinationLocationId: string;

  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  @IsOptional()
  notes?: string;

  /** Optional: a transfer may be opened empty and filled line by line. */
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => CreateStockTransferItemDto)
  @IsOptional()
  items?: CreateStockTransferItemDto[];
}
