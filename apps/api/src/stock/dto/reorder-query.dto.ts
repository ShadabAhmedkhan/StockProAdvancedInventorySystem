import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toBoolean } from '../../common/utils/transform.util';

export const REORDER_SORT_FIELDS = ['sku', 'name', 'availableStock', 'suggestedReorderQuantity'] as const;

export type ReorderSortField = (typeof REORDER_SORT_FIELDS)[number];

export class ReorderQueryDto extends PaginationQueryDto {
  @IsIn(REORDER_SORT_FIELDS)
  @IsOptional()
  sortBy: ReorderSortField = 'suggestedReorderQuantity';

  @IsIn(['asc', 'desc'])
  @IsOptional()
  override sortOrder: 'asc' | 'desc' = 'desc';

  /** Only products currently at or below their reorder point, projecting incoming stock. Defaults to true - the common "what needs action" view. */
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  needsReorderOnly = true;
}
