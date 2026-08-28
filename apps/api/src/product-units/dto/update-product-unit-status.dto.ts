import { IsEnum } from 'class-validator';
import { ProductUnitStatus } from '../../generated/prisma/enums';

export class UpdateProductUnitStatusDto {
  @IsEnum(ProductUnitStatus)
  status: ProductUnitStatus;
}
