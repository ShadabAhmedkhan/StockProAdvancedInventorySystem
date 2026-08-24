import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserRole } from '../generated/prisma/enums';
import { UpsertSettingDto } from './dto/upsert-setting.dto';
import { SettingsService } from './settings.service';
import type { SettingWithParsedValue } from './settings-views';

/**
 * System configuration. Reading is open to ADMIN and MANAGER, the same bar as
 * the user directory; writing is ADMIN only, since a setting can change how
 * the whole deployment behaves.
 */
@ApiBearerAuth('access-token')
@ApiTags('Settings')
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'List every setting' })
  findAll(): Promise<SettingWithParsedValue[]> {
    return this.settingsService.findAll();
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get one setting by key' })
  findOne(@Param('key') key: string): Promise<SettingWithParsedValue> {
    return this.settingsService.findOne(key);
  }

  @Roles(UserRole.ADMIN)
  @Put(':key')
  @ApiOperation({ summary: 'Create or replace a setting' })
  upsert(@Param('key') key: string, @Body() dto: UpsertSettingDto, @CurrentUser() caller: AuthenticatedUser): Promise<SettingWithParsedValue> {
    return this.settingsService.upsert(key, dto, caller.id);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a setting' })
  remove(@Param('key') key: string, @CurrentUser() caller: AuthenticatedUser): Promise<SettingWithParsedValue> {
    return this.settingsService.remove(key, caller.id);
  }
}
