import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../generated/prisma/enums';
import { AiService, type AiAnswer } from './ai.service';
import { AskDto } from './dto/ask.dto';

/**
 * StockPro Intelligence (Phase 42): business-intelligence Q&A over the ten
 * permission-aware tools in `AiToolsService`, not an open chatbot. Restricted
 * to ADMIN/MANAGER - the roles with reason to see organization-wide figures;
 * STAFF/TECHNICIAN keep their existing, narrower access everywhere else.
 */
@ApiBearerAuth('access-token')
@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('ask')
  @ApiOperation({ summary: 'Ask StockPro Intelligence a business question, answered only from tool data' })
  ask(@Body() dto: AskDto): Promise<AiAnswer> {
    return this.aiService.ask(dto.question);
  }
}
