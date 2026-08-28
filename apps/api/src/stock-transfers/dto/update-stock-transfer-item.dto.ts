import { PartialType, PickType } from '@nestjs/swagger';
import { CreateStockTransferItemDto } from './create-stock-transfer-item.dto';

/** The product on a line never changes: remove the line and add the right one. */
export class UpdateStockTransferItemDto extends PartialType(PickType(CreateStockTransferItemDto, ['quantity'] as const)) {}
