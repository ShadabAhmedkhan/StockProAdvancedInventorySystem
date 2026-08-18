import { IsEnum } from 'class-validator';
import { UserRole } from '../../generated/prisma/enums';

export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}
