import { PartialType } from '@nestjs/swagger';
import { CreateCategoryDto } from './create-category.dto';

/**
 * Every field optional. Renaming does **not** re-derive the slug: the slug is
 * a URL identifier, and silently changing it would break every link already
 * pointing at the category. Pass `slug` explicitly to change it.
 */
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
