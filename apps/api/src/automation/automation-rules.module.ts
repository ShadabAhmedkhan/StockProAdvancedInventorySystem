import { Module } from '@nestjs/common';
import { AutomationRulesController } from './automation-rules.controller';
import { AutomationRulesService } from './automation-rules.service';

@Module({
  controllers: [AutomationRulesController],
  providers: [AutomationRulesService],
})
export class AutomationRulesModule {}
