import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import type { AutomationRule, Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrismaClient } from '../prisma/tenant-prisma.provider';
import type { AutomationRuleQueryDto } from './dto/automation-rule-query.dto';
import type { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import type { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';

@Injectable()
export class AutomationRulesService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient) {}

  async findAll(query: AutomationRuleQueryDto): Promise<Paginated<AutomationRule>> {
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.automationRule.findMany({ orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.automationRule.count(),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<AutomationRule> {
    const rule = await this.prisma.automationRule.findUnique({ where: { id } });

    if (rule === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Automation rule not found' });
    }

    return rule;
  }

  create(dto: CreateAutomationRuleDto, userId: string): Promise<AutomationRule> {
    return this.prisma.automationRule.create({
      data: {
        organizationId: getCurrentOrgId(),
        name: dto.name,
        triggerType: dto.triggerType,
        conditions: dto.conditions as unknown as Prisma.InputJsonValue,
        actionRoles: dto.actionRoles,
        isActive: dto.isActive,
        createdById: userId,
      },
    });
  }

  async update(id: string, dto: UpdateAutomationRuleDto): Promise<AutomationRule> {
    await this.findOne(id);

    return this.prisma.automationRule.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.triggerType === undefined ? {} : { triggerType: dto.triggerType }),
        ...(dto.conditions === undefined ? {} : { conditions: dto.conditions as unknown as Prisma.InputJsonValue }),
        ...(dto.actionRoles === undefined ? {} : { actionRoles: dto.actionRoles }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });
  }

  async remove(id: string): Promise<AutomationRule> {
    await this.findOne(id);

    return this.prisma.automationRule.delete({ where: { id } });
  }
}
