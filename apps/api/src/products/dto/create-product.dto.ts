import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ProductCondition, ProductTrackingType } from '../../generated/prisma/enums';
import { toBoolean, toMoneyString, trim, trimUppercase } from '../../common/utils/transform.util';
import { BARCODE_PATTERN, MONEY_PATTERN, SKU_PATTERN } from '../../common/validation/patterns';

export class CreateProductDto {
  /** Upper-cased on input so `abc-1` and `ABC-1` cannot become two products. */
  @Matches(SKU_PATTERN, { message: 'sku must be upper-case letters, digits and hyphens' })
  @MaxLength(64)
  @Transform(trimUppercase)
  sku: string;

  @Matches(BARCODE_PATTERN, { message: 'barcode must be 4-64 letters, digits or hyphens' })
  @MaxLength(64)
  @Transform(trim)
  @IsOptional()
  barcode?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(trim)
  name: string;

  @IsString()
  @MaxLength(5000)
  @Transform(trim)
  @IsOptional()
  description?: string;

  @IsUUID()
  categoryId: string;

  @IsUUID()
  @IsOptional()
  brandId?: string;

  /**
   * Money is carried as an exact decimal string all the way to the database.
   * A JSON number is accepted and converted immediately, but no monetary value
   * is ever produced by floating-point arithmetic.
   */
  @Matches(MONEY_PATTERN, { message: 'costPrice must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  costPrice: string;

  @Matches(MONEY_PATTERN, { message: 'sellingPrice must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  sellingPrice: string;

  /** The level at which the product appears in the low-stock report. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minimumStock = 0;

  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  isActive = true;

  @IsEnum(ProductTrackingType)
  @IsOptional()
  trackingType?: ProductTrackingType = ProductTrackingType.NONE;

  @IsString()
  @MaxLength(120)
  @Transform(trim)
  @IsOptional()
  model?: string;

  @IsString()
  @MaxLength(120)
  @Transform(trim)
  @IsOptional()
  variant?: string;

  @IsString()
  @MaxLength(60)
  @Transform(trim)
  @IsOptional()
  color?: string;

  @IsString()
  @MaxLength(60)
  @Transform(trim)
  @IsOptional()
  storage?: string;

  @IsEnum(ProductCondition)
  @IsOptional()
  condition?: ProductCondition = ProductCondition.NEW;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  warrantyMonths?: number;
}
