import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { trim, trimLowercase, trimUppercase } from '../../common/utils/transform.util';
import { ENTITY_CODE_PATTERN, PHONE_PATTERN } from '../../common/validation/patterns';

export class CreateCustomerDto {
  /** A business-chosen identifier such as `CUS-0001`, like a SKU. */
  @Matches(ENTITY_CODE_PATTERN, { message: 'customerCode must look like CUS-0001' })
  @Transform(trimUppercase)
  customerCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(trim)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(trim)
  lastName: string;

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
