import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import { BaseAccountDto } from './base-account.dto';

/** Self-registration always creates a brand-new organization, with the registering
 * user as its first (and, at that moment, only) member - who becomes its ADMIN. */
export class RegisterDto extends BaseAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(trim)
  organizationName: string;
}
