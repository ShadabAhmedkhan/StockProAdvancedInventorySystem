import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toBoolean } from '../../common/utils/transform.util';

export const CATEGORY_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'slug'] as const;

export type CategorySortField = (typeof CATEGORY_SORT_FIELDS)[number];

export class CategoryQueryDto extends PaginationQueryDto {
  @IsIn(CATEGORY_SORT_FIELDS)
  @IsOptional()
  sortBy: CategorySortField = 'name';

  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  includeDeleted = false;

  /** Catalogue lists are usually short, so ascending by name is the useful default. */
  @IsIn(['asc', 'desc'])
  @IsOptional()
  override sortOrder: 'asc' | 'desc' = 'asc';
}
