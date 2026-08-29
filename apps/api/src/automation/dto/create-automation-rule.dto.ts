import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import { NotificationType, UserRole } from '../../generated/prisma/enums';
import { AutomationConditionDto } from './automation-condition.dto';

/** The events an automation rule may trigger on - the subset of `NotificationType` that carries
 * enough context (product, order, repair...) for a condition to meaningfully match against.
 * TRIAL_EXPIRING/SUBSCRIPTION_PAYMENT_FAILED/REPAIR_OVERDUE are cron-driven, org-wide facts with
 * nothing per-event to condition on, so they are deliberately excluded. */
export const AUTOMATION_TRIGGER_TYPES = [
  NotificationType.LOW_STOCK,
  NotificationType.OUT_OF_STOCK,
  NotificationType.ORDER_COMPLETED,
  NotificationType.PURCHASE_RECEIVED,
  NotificationType.REPAIR_READY,
] as const;

const MAX_CONDITIONS = 10;

export class CreateAutomationRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Transform(trim)
  name: string;

  @IsIn(AUTOMATION_TRIGGER_TYPES)
  triggerType: NotificationType;

  /** ANDed together. Empty (the default) means the action always fires. */
  @IsArray()
  @ArrayMaxSize(MAX_CONDITIONS)
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  @IsOptional()
  conditions: AutomationConditionDto[] = [];

  /** Notified on top of, not instead of, the event's own default ADMIN/MANAGER audience. */
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(UserRole, { each: true })
  actionRoles: UserRole[];

  @IsBoolean()
  @IsOptional()
  isActive = true;
}
