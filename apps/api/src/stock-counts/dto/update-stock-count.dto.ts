import { PartialType, PickType } from '@nestjs/swagger';
import { CreateStockCountDto } from './create-stock-count.dto';

/** Only notes are patchable after creation; the location and the item set are fixed by the workflow's own endpoints. */
export class UpdateStockCountDto extends PartialType(PickType(CreateStockCountDto, ['notes'] as const)) {}
