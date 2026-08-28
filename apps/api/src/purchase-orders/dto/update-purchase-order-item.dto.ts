import { PartialType, PickType } from '@nestjs/swagger';
import { CreatePurchaseOrderItemDto } from './create-purchase-order-item.dto';

/** The product on a line never changes: remove the line and add the right one. */
export class UpdatePurchaseOrderItemDto extends PartialType(PickType(CreatePurchaseOrderItemDto, ['quantity', 'unitCost', 'discount'] as const)) {}
