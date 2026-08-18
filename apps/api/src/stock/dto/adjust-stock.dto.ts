import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import { StockMovementType } from '../../generated/prisma/enums';

/**
 * The movement types a human may create directly.
 *
 * SALE, RETURN_IN, RETURN_OUT, REPAIR_IN and REPAIR_OUT are deliberately
 * absent: those are produced by the order, return and repair workflows, each
 * against a real document. Letting anyone post them by hand would make the
 * ledger claim a sale that never happened.
 */
export const MANUAL_MOVEMENT_TYPES = [StockMovementType.PURCHASE, StockMovementType.ADJUSTMENT_IN, StockMovementType.ADJUSTMENT_OUT] as const;

export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export class AdjustStockDto {
  @IsUUID()
  productId: string;

  @IsIn(MANUAL_MOVEMENT_TYPES, { message: `type must be one of ${MANUAL_MOVEMENT_TYPES.join(', ')}` })
  type: ManualMovementType;

  /** Always the magnitude of the change; direction comes from `type`. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  /** Why the stock moved. Free text, kept with the movement for the audit trail. */
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  @IsOptional()
  note?: string;
}
