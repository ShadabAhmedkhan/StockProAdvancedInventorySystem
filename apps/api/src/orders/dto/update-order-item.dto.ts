import { PartialType, PickType } from '@nestjs/swagger';
import { CreateOrderItemDto } from './create-order-item.dto';

/** The product on a line never changes: remove the line and add the right one. */
export class UpdateOrderItemDto extends PartialType(PickType(CreateOrderItemDto, ['quantity', 'unitPrice', 'discount'] as const)) {}
