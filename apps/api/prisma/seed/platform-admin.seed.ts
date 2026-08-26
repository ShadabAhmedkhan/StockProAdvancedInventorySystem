import { hashPassword } from '../../src/common/utils/password.util';
import { prisma } from './client';

/**
 * Optional: only creates the single `PlatformAdmin` row when both env vars
 * are set. An environment that never intends to use the platform-admin
 * panel can seed everything else without them.
 */
export async function seedPlatformAdmin(): Promise<{ email: string } | null> {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (email === undefined || email === '' || password === undefined || password === '') {
    return null;
  }

  const passwordHash = await hashPassword(password);

  await prisma.platformAdmin.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  return { email };
}
