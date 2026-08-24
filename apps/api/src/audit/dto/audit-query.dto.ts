import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuditAction, AuditEntity } from '../../generated/prisma/enums';

export const AUDIT_SORT_FIELDS = ['createdAt'] as const;

export type AuditSortField = (typeof AUDIT_SORT_FIELDS)[number];

export class AuditQueryDto extends PaginationQueryDto {
  @IsIn(AUDIT_SORT_FIELDS)
  @IsOptional()
  sortBy: AuditSortField = 'createdAt';

  @IsUUID()
  @IsOptional()
  userId?: string;

  @IsEnum(AuditAction)
  @IsOptional()
  action?: AuditAction;

  @IsEnum(AuditEntity)
  @IsOptional()
  entity?: AuditEntity;

  @IsUUID()
  @IsOptional()
  entityId?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  createdFrom?: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  createdTo?: Date;
}
