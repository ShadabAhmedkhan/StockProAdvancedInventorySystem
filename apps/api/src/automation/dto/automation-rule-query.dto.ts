import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const AUTOMATION_RULE_SORT_FIELDS = ['createdAt', 'name'] as const;

export type AutomationRuleSortField = (typeof AUTOMATION_RULE_SORT_FIELDS)[number];

export class AutomationRuleQueryDto extends PaginationQueryDto {
  @IsIn(AUTOMATION_RULE_SORT_FIELDS)
  @IsOptional()
  sortBy: AutomationRuleSortField = 'createdAt';
}
