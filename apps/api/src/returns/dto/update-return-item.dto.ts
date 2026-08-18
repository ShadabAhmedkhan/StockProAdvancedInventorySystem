import { PartialType, PickType } from '@nestjs/swagger';
import { CreateReturnItemDto } from './create-return-item.dto';

/** The order line a return line came from never changes: remove it and re-add. */
export class UpdateReturnItemDto extends PartialType(PickType(CreateReturnItemDto, ['quantity', 'restock'] as const)) {}
