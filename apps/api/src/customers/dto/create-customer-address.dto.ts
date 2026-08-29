import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util';

export class CreateCustomerAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Transform(trim)
  label: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(trim)
  line1: string;

  @IsString()
  @MaxLength(255)
  @Transform(trim)
  @IsOptional()
  line2?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(trim)
  city: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(trim)
  state: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Transform(trim)
  postalCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(trim)
  country: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
