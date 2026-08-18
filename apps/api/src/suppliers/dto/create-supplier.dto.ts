import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { trim, trimLowercase, trimUppercase } from '../../common/utils/transform.util';
import { ENTITY_CODE_PATTERN, PHONE_PATTERN } from '../../common/validation/patterns';

export class CreateSupplierDto {
  /** A business-chosen identifier such as `SUP-0001`. */
  @Matches(ENTITY_CODE_PATTERN, { message: 'supplierCode must look like SUP-0001' })
  @Transform(trimUppercase)
  supplierCode: string;

  /** The trading name. Suppliers are organisations, so there is one name field. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(trim)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Transform(trim)
  @IsOptional()
  contactPerson?: string;

  @Matches(PHONE_PATTERN, { message: 'phone must be a valid phone number' })
  @MaxLength(32)
  @Transform(trim)
  phone: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  @Transform(trimLowercase)
  @IsOptional()
  email?: string;

  @IsString()
  @MaxLength(500)
  @Transform(trim)
  @IsOptional()
  address?: string;

  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  @IsOptional()
  notes?: string;
}
