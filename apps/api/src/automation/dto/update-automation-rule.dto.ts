import { PartialType } from '@nestjs/swagger';
import { CreateAutomationRuleDto } from './create-automation-rule.dto';

export class UpdateAutomationRuleDto extends PartialType(CreateAutomationRuleDto) {}
