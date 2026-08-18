import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../generated/prisma/enums';

export const ROLES_KEY = 'stockpro:roles';

/**
 * Restricts a route to the listed roles. Without it, any authenticated user
 * may call the endpoint.
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
