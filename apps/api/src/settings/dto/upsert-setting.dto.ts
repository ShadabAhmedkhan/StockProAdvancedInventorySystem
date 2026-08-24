import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import { SettingValueType } from '../../generated/prisma/enums';

export class UpsertSettingDto {
  /** Stored as text regardless of `valueType`; parsing happens on read. */
  @IsString()
  @MaxLength(2000)
  value: string;

  @IsEnum(SettingValueType)
  @IsOptional()
  valueType: SettingValueType = SettingValueType.STRING;

  @IsString()
  @MaxLength(500)
  @Transform(trim)
  @IsOptional()
  description?: string;
}
