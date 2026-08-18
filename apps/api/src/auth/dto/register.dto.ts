import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { trim, trimLowercase } from '../../common/utils/transform.util';

/** At least one lower-case letter, one upper-case letter and one digit. */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
export const PASSWORD_MIN_LENGTH = 10;

/** Argon2 has no practical input limit, but an unbounded body is a DoS vector. */
export const PASSWORD_MAX_LENGTH = 128;

export class RegisterDto {
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

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  @Transform(trimLowercase)
  email: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `password must be at least ${String(PASSWORD_MIN_LENGTH)} characters` })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: 'password must contain an upper-case letter, a lower-case letter and a digit' })
  password: string;
}
