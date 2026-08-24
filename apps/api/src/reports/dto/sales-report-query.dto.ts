import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional } from 'class-validator';

export const SALES_REPORT_PERIODS = ['day', 'week', 'month'] as const;

export type SalesReportPeriod = (typeof SALES_REPORT_PERIODS)[number];

export class SalesReportQueryDto {
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  from?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  to?: Date;

  @IsIn(SALES_REPORT_PERIODS)
  @IsOptional()
  groupBy: SalesReportPeriod = 'day';
}
