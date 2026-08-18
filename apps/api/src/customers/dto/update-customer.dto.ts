import { PartialType } from '@nestjs/swagger';
import { CreateCustomerDto } from './create-customer.dto';

/**
 * Every field optional. Validation and normalisation are inherited, so a
 * rule added to creation cannot be forgotten on update.
 */
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
