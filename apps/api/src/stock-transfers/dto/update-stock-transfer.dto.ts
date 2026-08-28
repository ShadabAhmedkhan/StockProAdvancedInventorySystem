import { PartialType, PickType } from '@nestjs/swagger';
import { CreateStockTransferDto } from './create-stock-transfer.dto';

/**
 * The header fields of a draft.
 *
 * Items are deliberately not patchable here: adding, changing and removing a
 * line each have their own endpoint, mirroring UpdatePurchaseOrderDto.
 */
export class UpdateStockTransferDto extends PartialType(
  PickType(CreateStockTransferDto, ['sourceLocationId', 'destinationLocationId', 'notes'] as const),
) {}
