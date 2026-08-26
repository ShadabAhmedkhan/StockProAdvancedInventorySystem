import { prisma } from './client';

/** The one organization the dev seed populates. Every seeded record belongs to it. */
const ORGANIZATION_NAME = 'Stock Pro Demo Co';

export interface SeededOrganization {
  id: string;
}

export async function seedOrganization(): Promise<SeededOrganization> {
  const existing = await prisma.organization.findFirst({ where: { name: ORGANIZATION_NAME }, select: { id: true } });
  if (existing !== null) {
    return existing;
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 14);

  const organization = await prisma.organization.create({
    data: { name: ORGANIZATION_NAME, subscriptionStatus: 'TRIALING', trialEndsAt },
    select: { id: true },
  });

  return organization;
}
