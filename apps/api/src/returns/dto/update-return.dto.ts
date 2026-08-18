import { PartialType, PickType } from '@nestjs/swagger';
import { CreateReturnDto } from './create-return.dto';

/**
 * The header of a pending return. The order it came from is fixed: goods
 * belong to the sale that produced them, and moving a return to another order
 * would divorce the refund from what was charged.
 */
export class UpdateReturnDto extends PartialType(PickType(CreateReturnDto, ['reason', 'reasonNote'] as const)) {}
