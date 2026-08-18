import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UserRole, UserStatus } from '../../generated/prisma/enums';

/**
 * Columns a client may order by.
 *
 * An explicit whitelist rather than an open column name: passing user input
 * straight to `orderBy` would let a caller sort by `passwordHash` and read the
 * hash space one binary-search request at a time.
 */
export const USER_SORT_FIELDS = ['createdAt', 'updatedAt', 'lastLoginAt', 'firstName', 'lastName', 'email', 'role', 'status'] as const;

export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export class UserQueryDto extends PaginationQueryDto {
  @IsIn(USER_SORT_FIELDS)
  @IsOptional()
  sortBy: UserSortField = 'createdAt';

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;
}
