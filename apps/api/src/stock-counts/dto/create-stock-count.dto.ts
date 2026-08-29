import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util';

/** Caps the work one request can ask for; a count may be extended afterwards with more items. */
const MAX_PRODUCT_IDS_PER_REQUEST = 500;

export class CreateStockCountDto {
  @IsUUID()
  locationId: string;

  /**
   * Explicit products to count. Omit it to count every active product that
   * already holds an inventory row at this location - the common case of "count
   * everything on the floor" - without making the caller enumerate them.
   */
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_IDS_PER_REQUEST)
  @IsUUID(undefined, { each: true })
  @IsOptional()
  productIds?: string[];

  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  @IsOptional()
  notes?: string;
}
