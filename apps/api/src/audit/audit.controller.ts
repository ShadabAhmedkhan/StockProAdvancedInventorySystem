import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import type { Paginated } from '../common/pagination/paginated';
import { UserRole } from '../generated/prisma/enums';
import { AuditQueryDto } from './dto/audit-query.dto';
import { AuditService } from './audit.service';
import type { AuditLogWithActor } from './audit-views';

/**
 * The security and money trail. Restricted to ADMIN, unlike most read
 * endpoints in this API: it names who did what, from where, and can include
 * business context no other role needs to see across the whole system.
 */
@ApiBearerAuth('access-token')
@ApiTags('Audit')
@Roles(UserRole.ADMIN)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List audit entries with pagination and filters' })
  findAll(@Query() query: AuditQueryDto): Promise<Paginated<AuditLogWithActor>> {
    return this.auditService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one audit entry' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AuditLogWithActor> {
    return this.auditService.findOne(id);
  }
}
