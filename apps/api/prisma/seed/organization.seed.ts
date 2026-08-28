import { prisma } from './client';

/** The one organization the dev seed populates. Every seeded record belongs to it. */
const ORGANIZATION_NAME = 'Stock Pro Demo Co';

export interface SeededOrganization {
  id: string;
  defaultLocationId: string;
}

export async function seedOrganization(): Promise<SeededOrganization> {
  const existing = await prisma.organization.findFirst({ where: { name: ORGANIZATION_NAME }, select: { id: true } });
  if (existing !== null) {
    const location = await prisma.location.findFirstOrThrow({
      where: { organizationId: existing.id, isDefault: true },
      select: { id: true },
    });
    return { id: existing.id, defaultLocationId: location.id };
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 14);

  const organization = await prisma.organization.create({
    data: { name: ORGANIZATION_NAME, subscriptionStatus: 'TRIALING', trialEndsAt },
    select: { id: true },
  });

  const location = await prisma.location.create({
    data: { organizationId: organization.id, name: 'Main Location', type: 'STORE', isDefault: true },
    select: { id: true },
  });

  return { id: organization.id, defaultLocationId: location.id };
}
