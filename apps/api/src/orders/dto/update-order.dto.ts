import { PartialType, PickType } from '@nestjs/swagger';
import { CreateOrderDto } from './create-order.dto';

/**
 * The header fields of a draft.
 *
 * Items are deliberately not patchable here: adding, changing and removing a
 * line each have their own endpoint, because each one has to re-price the
 * order and check stock, and burying that in a whole-order PATCH would make
 * the write ambiguous.
 */
export class UpdateOrderDto extends PartialType(PickType(CreateOrderDto, ['customerId', 'discount', 'tax', 'notes'] as const)) {}
