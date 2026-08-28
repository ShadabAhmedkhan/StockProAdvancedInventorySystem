import { PartialType } from '@nestjs/swagger';
import { CreateLocationDto } from './create-location.dto';

/**
 * Every field optional. Validation and normalisation are inherited, so a rule
 * added to creation cannot be forgotten on update.
 */
export class UpdateLocationDto extends PartialType(CreateLocationDto) {}
