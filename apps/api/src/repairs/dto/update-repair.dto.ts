import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';
import { toMoneyString } from '../../common/utils/transform.util';
import { MONEY_PATTERN } from '../../common/validation/patterns';
import { CreateRepairDto } from './create-repair.dto';

/**
 * Everything about a repair that can change while it is open, plus the final
 * cost, which only exists once the work is understood.
 *
 * `customerId` is inherited from the create DTO and can be corrected: intake
 * at a busy counter attaches the wrong customer often enough that refusing to
 * fix it would mean cancelling and re-receiving the device.
 */
export class UpdateRepairDto extends PartialType(CreateRepairDto) {
  /** What is actually charged. Must be set before the repair can be completed. */
  @Matches(MONEY_PATTERN, { message: 'finalCost must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  finalCost?: string;
}
