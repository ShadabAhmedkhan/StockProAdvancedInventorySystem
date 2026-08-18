import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import { PaymentMethod } from '../../generated/prisma/enums';

export class CompleteReturnDto {
  /** How the money went back. Recorded on the refund, like any other payment. */
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  /** External identifier such as a card refund authorisation. */
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  @IsOptional()
  reference?: string;

  @IsString()
  @MaxLength(500)
  @Transform(trim)
  @IsOptional()
  note?: string;
}
