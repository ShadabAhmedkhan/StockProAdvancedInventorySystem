import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import { ReturnReason } from '../../generated/prisma/enums';
import { CreateReturnItemDto } from './create-return-item.dto';

/** Caps the work one request can ask for; larger returns add lines afterwards. */
const MAX_ITEMS_PER_REQUEST = 100;

export class CreateReturnDto {
  /** Goods can only come back from an order that actually went out. */
  @IsUUID()
  orderId: string;

  @IsEnum(ReturnReason)
  reason: ReturnReason;

  /** What the customer said, in their words. */
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  @IsOptional()
  reasonNote?: string;

  /** A return with no lines refunds nothing, so at least one is required. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ITEMS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  items: CreateReturnItemDto[];
}
