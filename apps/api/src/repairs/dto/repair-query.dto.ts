import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toBoolean } from '../../common/utils/transform.util';
import { DeviceType, RepairStatus } from '../../generated/prisma/enums';

export const REPAIR_SORT_FIELDS = ['receivedAt', 'completedAt', 'expectedCompletionAt', 'repairNumber', 'status', 'createdAt'] as const;

export type RepairSortField = (typeof REPAIR_SORT_FIELDS)[number];

export class RepairQueryDto extends PaginationQueryDto {
  @IsIn(REPAIR_SORT_FIELDS)
  @IsOptional()
  sortBy: RepairSortField = 'receivedAt';

  @IsEnum(RepairStatus)
  @IsOptional()
  status?: RepairStatus;

  @IsEnum(DeviceType)
  @IsOptional()
  deviceType?: DeviceType;

  @IsUUID()
  @IsOptional()
  customerId?: string;

  @IsUUID()
  @IsOptional()
  technicianId?: string;

  /**
   * Narrows to the repairs still on the bench, without the caller having to
   * list six statuses. The workbench view is the whole reason this module
   * exists, so it gets a first-class filter.
   */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  openOnly?: boolean;

  /**
   * Repairs whose promised date has passed and which are not finished. The
   * question a shop actually asks: what is late?
   */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  overdue?: boolean;

  /** Repairs with nobody assigned, which is what a queue is for. */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  unassigned?: boolean;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  receivedFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  receivedTo?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  completedFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  completedTo?: Date;
}
