import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_PATTERN } from './base-account.dto';

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `password must be at least ${String(PASSWORD_MIN_LENGTH)} characters` })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: 'password must contain an upper-case letter, a lower-case letter and a digit' })
  password: string;
}
