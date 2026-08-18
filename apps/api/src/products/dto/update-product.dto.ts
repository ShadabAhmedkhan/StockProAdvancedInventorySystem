import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

/**
 * Every field optional. Validation and normalisation are inherited, so a rule
 * added to creation cannot be forgotten on update.
 *
 * Stock levels are deliberately absent: quantity changes go through the stock
 * endpoints so that every movement is recorded in the ledger.
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {}
