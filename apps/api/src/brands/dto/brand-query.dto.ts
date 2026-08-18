import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toBoolean } from '../../common/utils/transform.util';

export const BRAND_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'slug'] as const;

export type BrandSortField = (typeof BRAND_SORT_FIELDS)[number];

export class BrandQueryDto extends PaginationQueryDto {
  @IsIn(BRAND_SORT_FIELDS)
  @IsOptional()
  sortBy: BrandSortField = 'name';

  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  includeDeleted = false;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  override sortOrder: 'asc' | 'desc' = 'asc';
}
