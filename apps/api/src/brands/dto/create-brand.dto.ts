import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { trim, trimLowercase } from '../../common/utils/transform.util';
import { SLUG_PATTERN } from '../../common/validation/patterns';

export class CreateBrandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(trim)
  name: string;

  /** Optional. Derived from the name when omitted. */
  @Matches(SLUG_PATTERN, { message: 'slug must be lower-case words joined by single hyphens' })
  @MaxLength(140)
  @Transform(trimLowercase)
  @IsOptional()
  slug?: string;
}
