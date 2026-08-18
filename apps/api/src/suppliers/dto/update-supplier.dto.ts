import { PartialType } from '@nestjs/swagger';
import { CreateSupplierDto } from './create-supplier.dto';

/**
 * Every field optional. Validation and normalisation are inherited, so a rule
 * added to creation cannot be forgotten on update.
 */
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}
