import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class FinanceSummaryQueryDto {
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  from?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  to?: Date;
}
