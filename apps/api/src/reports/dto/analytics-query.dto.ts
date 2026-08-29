import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Min } from 'class-validator';

export class AnalyticsQueryDto {
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  from?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  to?: Date;

  /** A product with no SALE movement in this many days, while still on the shelf, counts as dead stock. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  deadStockDays = 90;
}
