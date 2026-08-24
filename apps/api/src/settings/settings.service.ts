import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../common/enums/error-code.enum';
import { AuditAction, AuditEntity } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertSettingDto } from './dto/upsert-setting.dto';
import { invalidValueReason, withParsedValue, type SettingWithParsedValue } from './settings-views';

/**
 * System configuration, keyed by name rather than id: a caller wants "the
 * setting called `low_stock_alert_threshold`", not a uuid it has to look up
 * first. `value` stays the single stored column regardless of `valueType`;
 * `parsedValue` is decoded from it on every read rather than kept as a
 * second column that could drift from the text it was parsed from.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(): Promise<SettingWithParsedValue[]> {
    const settings = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });

    return settings.map(withParsedValue);
  }

  async findOne(key: string): Promise<SettingWithParsedValue> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });

    if (setting === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Setting not found' });
    }

    return withParsedValue(setting);
  }

  /** Creates the setting if `key` is new, replaces its value and type if it already exists. */
  async upsert(key: string, dto: UpsertSettingDto, callerId: string): Promise<SettingWithParsedValue> {
    const reason = invalidValueReason(dto.value, dto.valueType);

    if (reason !== null) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_ERROR, message: 'Validation failed', errors: [{ field: 'value', constraints: [reason] }] });
    }

    const existing = await this.prisma.setting.findUnique({ where: { key }, select: { id: true } });

    const setting = await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: dto.value, valueType: dto.valueType, description: dto.description ?? null },
      update: { value: dto.value, valueType: dto.valueType, ...(dto.description === undefined ? {} : { description: dto.description }) },
    });

    await this.auditService.record({
      userId: callerId,
      action: existing === null ? AuditAction.CREATE : AuditAction.UPDATE,
      entity: AuditEntity.SETTING,
      entityId: setting.id,
      metadata: { key, valueType: dto.valueType },
    });

    return withParsedValue(setting);
  }

  async remove(key: string, callerId: string): Promise<SettingWithParsedValue> {
    const setting = await this.findOne(key);

    await this.prisma.setting.delete({ where: { key } });

    await this.auditService.record({ userId: callerId, action: AuditAction.DELETE, entity: AuditEntity.SETTING, entityId: setting.id, metadata: { key } });

    return setting;
  }
}
