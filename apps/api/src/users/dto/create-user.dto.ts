import { IsEnum, IsOptional } from 'class-validator';
import { BaseAccountDto } from '../../auth/dto/base-account.dto';
import { UserRole, UserStatus } from '../../generated/prisma/enums';

/**
 * Administrator-issued account creation: a teammate joining the caller's own
 * organization (its id comes from the caller's session, not this DTO), unlike
 * self-registration this may set any role, which is why the endpoint is
 * restricted to ADMIN.
 */
export class CreateUserDto extends BaseAccountDto {
  @IsEnum(UserRole)
  @IsOptional()
  role: UserRole = UserRole.STAFF;

  @IsEnum(UserStatus)
  @IsOptional()
  status: UserStatus = UserStatus.ACTIVE;
}
