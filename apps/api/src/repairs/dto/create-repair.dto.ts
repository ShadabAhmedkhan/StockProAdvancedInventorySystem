import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { toMoneyString, trim, trimUppercase } from '../../common/utils/transform.util';
import { MONEY_PATTERN } from '../../common/validation/patterns';
import { DeviceType } from '../../generated/prisma/enums';

export class CreateRepairDto {
  /** Repairs always belong to someone: the device has to go back to its owner. */
  @IsUUID()
  customerId: string;

  @IsEnum(DeviceType)
  deviceType: DeviceType;

  /** The manufacturer of the customer's device, unrelated to the sales catalogue. */
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  @IsOptional()
  brand?: string;

  @IsString()
  @MaxLength(100)
  @Transform(trim)
  @IsOptional()
  model?: string;

  /** Upper-cased so the same device is found however it was typed in. */
  @IsString()
  @MaxLength(100)
  @Transform(trimUppercase)
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @MaxLength(32)
  @Transform(trimUppercase)
  @IsOptional()
  imei?: string;

  /** What the customer says is wrong. The one field intake cannot do without. */
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Transform(trim)
  problemDescription: string;

  /** What the technician finds. Usually filled in later, at DIAGNOSING. */
  @IsString()
  @MaxLength(5000)
  @Transform(trim)
  @IsOptional()
  diagnosis?: string;

  /** The quote given to the customer, before the work is done. */
  @Matches(MONEY_PATTERN, { message: 'estimatedCost must be a non-negative amount with at most two decimal places' })
  @Transform(toMoneyString)
  @IsOptional()
  estimatedCost?: string;

  @IsUUID()
  @IsOptional()
  technicianId?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  expectedCompletionAt?: Date;

  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  @IsOptional()
  notes?: string;
}
