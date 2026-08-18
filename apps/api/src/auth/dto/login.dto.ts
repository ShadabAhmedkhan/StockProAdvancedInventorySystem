import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { trimLowercase } from '../../common/utils/transform.util';

/**
 * Login validation is deliberately looser than registration: rejecting a
 * short password before checking it would tell an attacker that the stored
 * password is longer than what they tried.
 */
export class LoginDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  @Transform(trimLowercase)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
