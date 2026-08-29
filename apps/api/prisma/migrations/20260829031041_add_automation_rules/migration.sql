-- CreateEnum
CREATE TYPE "AutomationConditionOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN');

-- CreateEnum
CREATE TYPE "AutomationActionType" AS ENUM ('NOTIFY');

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "triggerType" "NotificationType" NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actionType" "AutomationActionType" NOT NULL DEFAULT 'NOTIFY',
    "actionRoles" "UserRole"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_organizationId_idx" ON "AutomationRule"("organizationId");

-- CreateIndex
CREATE INDEX "AutomationRule_triggerType_isActive_idx" ON "AutomationRule"("triggerType", "isActive");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
