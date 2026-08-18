import { PartialType } from '@nestjs/swagger';
import { CreateBrandDto } from './create-brand.dto';

/** Every field optional. Renaming does not re-derive the slug; pass it explicitly. */
export class UpdateBrandDto extends PartialType(CreateBrandDto) {}
