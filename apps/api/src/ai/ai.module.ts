import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FinanceModule } from '../finance/finance.module';
import { ReportsModule } from '../reports/reports.module';
import { StockModule } from '../stock/stock.module';
import { aiConfig } from '../config/ai.config';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiToolsService } from './ai-tools.service';

@Module({
  imports: [ConfigModule.forFeature(aiConfig), ReportsModule, StockModule, FinanceModule],
  controllers: [AiController],
  providers: [AiToolsService, AiService],
})
export class AiModule {}
