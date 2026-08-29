import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import type { AutomationRule } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { AutomationRulesService } from './automation-rules.service';
import { AutomationRuleQueryDto } from './dto/automation-rule-query.dto';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';

/** Rules govern who else gets notified organization-wide, so only ADMIN/MANAGER configure them - same bar as billing and settings. */
@ApiBearerAuth('access-token')
@ApiTags('Automation Rules')
@Controller('automation-rules')
export class AutomationRulesController {
  constructor(private readonly automationRulesService: AutomationRulesService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get()
  @ApiOperation({ summary: 'List automation rules' })
  findAll(@Query() query: AutomationRuleQueryDto): Promise<Paginated<AutomationRule>> {
    return this.automationRulesService.findAll(query);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get(':id')
  @ApiOperation({ summary: 'Get one automation rule' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AutomationRule> {
    return this.automationRulesService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Create an automation rule' })
  create(@Body() dto: CreateAutomationRuleDto, @CurrentUser() caller: AuthenticatedUser): Promise<AutomationRule> {
    return this.automationRulesService.create(dto, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Update an automation rule' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAutomationRuleDto): Promise<AutomationRule> {
    return this.automationRulesService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an automation rule' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<AutomationRule> {
    return this.automationRulesService.remove(id);
  }
}
