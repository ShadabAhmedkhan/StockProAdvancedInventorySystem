import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ProductUnitStatus } from '../../generated/prisma/enums';

export const PRODUCT_UNIT_SORT_FIELDS = ['createdAt', 'updatedAt', 'serialNumber'] as const;

export type ProductUnitSortField = (typeof PRODUCT_UNIT_SORT_FIELDS)[number];

export class ProductUnitQueryDto extends PaginationQueryDto {
  @IsIn(PRODUCT_UNIT_SORT_FIELDS)
  @IsOptional()
  sortBy: ProductUnitSortField = 'createdAt';

  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsIn(Object.values(ProductUnitStatus))
  @IsOptional()
  status?: ProductUnitStatus;
}
