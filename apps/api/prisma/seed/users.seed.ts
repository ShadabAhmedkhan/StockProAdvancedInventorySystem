import { hashPassword } from '../../src/common/utils/password.util';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums';
import { prisma } from './client';

/**
 * Development password for every seeded account.
 *
 * Local development only. The README says so explicitly, and production
 * deployments create their first administrator through the registration
 * endpoint rather than by running this seed.
 */
export const SEED_PASSWORD = 'Password123!';

interface SeededUser {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

const USERS: SeededUser[] = [
  { email: 'admin@stockpro.test', firstName: 'Amara', lastName: 'Okafor', role: UserRole.ADMIN },
  { email: 'manager@stockpro.test', firstName: 'Priya', lastName: 'Raman', role: UserRole.MANAGER },
  { email: 'staff1@stockpro.test', firstName: 'Diego', lastName: 'Salas', role: UserRole.STAFF },
  { email: 'staff2@stockpro.test', firstName: 'Noor', lastName: 'Haddad', role: UserRole.STAFF },
  // Repairs must be assignable to somebody, so the seed includes one technician.
  { email: 'tech@stockpro.test', firstName: 'Kenji', lastName: 'Watanabe', role: UserRole.TECHNICIAN },
];

export interface SeededUsers {
  admin: { id: string };
  manager: { id: string };
  staff: { id: string }[];
  technician: { id: string };
}

export async function seedUsers(organizationId: string): Promise<SeededUsers> {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const created = await Promise.all(
    USERS.map((user) =>
      prisma.user.upsert({
        where: { email: user.email },
        update: { firstName: user.firstName, lastName: user.lastName, role: user.role, status: UserStatus.ACTIVE },
        create: { ...user, organizationId, passwordHash, status: UserStatus.ACTIVE },
        select: { id: true, role: true, email: true },
      }),
    ),
  );

  const byEmail = new Map(created.map((user) => [user.email, user]));

  function require(email: string): { id: string } {
    const user = byEmail.get(email);
    if (user === undefined) {
      throw new Error(`Seed user ${email} was not created`);
    }
    return { id: user.id };
  }

  return {
    admin: require('admin@stockpro.test'),
    manager: require('manager@stockpro.test'),
    staff: [require('staff1@stockpro.test'), require('staff2@stockpro.test')],
    technician: require('tech@stockpro.test'),
  };
}
