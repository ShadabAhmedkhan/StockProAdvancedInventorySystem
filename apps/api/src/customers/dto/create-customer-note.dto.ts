import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util';

export class CreateCustomerNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @Transform(trim)
  body: string;
}
