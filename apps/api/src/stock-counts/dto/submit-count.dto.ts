import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { trim } from '../../common/utils/transform.util';

/** What a counter enters for one line - the physical quantity found on the shelf. */
export class SubmitCountDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedQuantity: number;

  @IsString()
  @MaxLength(500)
  @Transform(trim)
  @IsOptional()
  notes?: string;
}
