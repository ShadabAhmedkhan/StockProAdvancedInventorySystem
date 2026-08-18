import { PartialType, PickType } from '@nestjs/swagger';
import { CreateRepairItemDto } from './create-repair-item.dto';

/** The part on a line never changes: remove the line and add the right part. */
export class UpdateRepairItemDto extends PartialType(PickType(CreateRepairItemDto, ['quantity', 'unitPrice'] as const)) {}
