import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { trimLowercase } from '../../common/utils/transform.util';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  @Transform(trimLowercase)
  email: string;
}
