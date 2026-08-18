import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { trim, trimLowercase } from '../../common/utils/transform.util';
import { SLUG_PATTERN } from '../../common/validation/patterns';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(trim)
  name: string;

  /**
   * Optional. Derived from the name when omitted, which is what most callers
   * want; supply it explicitly to pin a URL that must not change.
   */
  @Matches(SLUG_PATTERN, { message: 'slug must be lower-case words joined by single hyphens' })
  @MaxLength(140)
  @Transform(trimLowercase)
  @IsOptional()
  slug?: string;

  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  @IsOptional()
  description?: string;
}
