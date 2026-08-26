import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { trimLowercase } from '../../common/utils/transform.util';

export class PlatformAdminLoginDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  @Transform(trimLowercase)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
