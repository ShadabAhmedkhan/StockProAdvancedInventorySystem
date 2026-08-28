import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util';
import { LocationType } from '../../generated/prisma/enums';

export class CreateLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(trim)
  name: string;

  @IsEnum(LocationType)
  @IsOptional()
  type: LocationType = LocationType.STORE;

  @IsString()
  @MaxLength(500)
  @Transform(trim)
  @IsOptional()
  address?: string;
}
