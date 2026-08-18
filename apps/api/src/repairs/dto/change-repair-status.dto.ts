import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import { RepairStatus } from '../../generated/prisma/enums';

export class ChangeRepairStatusDto {
  @IsEnum(RepairStatus)
  toStatus: RepairStatus;

  /** Why it moved. Kept on the history row, which is the repair's audit trail. */
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  @IsOptional()
  note?: string;
}
