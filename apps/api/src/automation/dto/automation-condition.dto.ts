import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import type { ConditionOperator } from '../evaluate-automation';

export const CONDITION_OPERATORS = ['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN'] as const;

/**
 * One `field operator value` comparison, evaluated against the trigger's own
 * context object - never executed as code. `field` is whatever the trigger
 * type exposes (e.g. LOW_STOCK's context has `sku`, `categoryName`,
 * `quantity`); an unknown field simply never matches, rather than erroring.
 */
export class AutomationConditionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Transform(trim)
  field: string;

  @IsIn(CONDITION_OPERATORS)
  operator: ConditionOperator;

  @IsString()
  @MaxLength(200)
  @Transform(trim)
  value: string;
}
