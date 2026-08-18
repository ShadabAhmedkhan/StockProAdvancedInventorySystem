import { IsEnum, IsOptional } from 'class-validator';
import { RegisterDto } from '../../auth/dto/register.dto';
import { UserRole, UserStatus } from '../../generated/prisma/enums';

/**
 * Administrator-issued account creation. Unlike self-registration this may set
 * any role, which is why the endpoint is restricted to ADMIN.
 */
export class CreateUserDto extends RegisterDto {
  @IsEnum(UserRole)
  @IsOptional()
  role: UserRole = UserRole.STAFF;

  @IsEnum(UserStatus)
  @IsOptional()
  status: UserStatus = UserStatus.ACTIVE;
}
