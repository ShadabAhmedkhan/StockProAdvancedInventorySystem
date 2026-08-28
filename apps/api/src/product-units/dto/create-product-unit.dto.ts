import { Transform } from 'class-transformer';
import { IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';
import { trimUppercase } from '../../common/utils/transform.util';
import { SERIAL_NUMBER_PATTERN } from '../../common/validation/patterns';

export class CreateProductUnitDto {
  @IsUUID()
  productId: string;

  /** Defaults to the org's default location when omitted. */
  @IsUUID()
  @IsOptional()
  locationId?: string;

  /** Holds the serial number or IMEI - format is checked against the product's trackingType in the service. */
  @Matches(SERIAL_NUMBER_PATTERN, { message: 'serialNumber must be 4-64 letters, digits or hyphens' })
  @MaxLength(64)
  @Transform(trimUppercase)
  serialNumber: string;
}
