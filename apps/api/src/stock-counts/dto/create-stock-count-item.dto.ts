import { IsUUID } from 'class-validator';

export class CreateStockCountItemDto {
  @IsUUID()
  productId: string;
}
