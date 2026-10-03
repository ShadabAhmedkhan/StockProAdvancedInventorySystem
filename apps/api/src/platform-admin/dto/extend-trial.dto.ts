import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const MAX_TRIAL_EXTENSION_DAYS = 365;

export class ExtendTrialDto {
  /** Added to whichever is later - the current trial end or now - so a lapsed trial restarts from today. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_TRIAL_EXTENSION_DAYS)
  days: number;
}
