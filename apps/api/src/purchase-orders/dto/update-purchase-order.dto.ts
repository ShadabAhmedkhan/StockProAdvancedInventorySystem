import { PartialType, PickType } from '@nestjs/swagger';
import { CreatePurchaseOrderDto } from './create-purchase-order.dto';

/**
 * The header fields of a draft.
 *
 * Items are deliberately not patchable here: adding, changing and removing a
 * line each have their own endpoint, mirroring UpdateOrderDto.
 */
export class UpdatePurchaseOrderDto extends PartialType(
  PickType(CreatePurchaseOrderDto, ['supplierId', 'expectedDate', 'discount', 'tax', 'shipping', 'notes'] as const),
) {}
