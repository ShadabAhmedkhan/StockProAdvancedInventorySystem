import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { trim, trimLowercase } from '../../common/utils/transform.util';

/** Profile fields only. Role and status change through their own endpoints. */
export class UpdateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(trim)
  @IsOptional()
  firstName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(trim)
  @IsOptional()
  lastName?: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  @Transform(trimLowercase)
  @IsOptional()
  email?: string;
}
