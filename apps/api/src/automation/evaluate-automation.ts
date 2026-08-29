import type { NotificationType, UserRole } from '../generated/prisma/enums';
import { notify, type NotifyClient } from '../notifications/notify';

export type ConditionOperator = 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN';

export interface AutomationCondition {
  field: string;
  operator: ConditionOperator;
  value: string;
}

/** Additional methods `runAutomationRules` needs beyond what `notify()` already requires. */
interface AutomationClient extends NotifyClient {
  automationRule: {
    findMany(args: {
      where: { organizationId: string; triggerType: NotificationType; isActive: true };
      select: { id: true; name: true; conditions: true; actionRoles: true };
    }): Promise<{ id: string; name: string; conditions: unknown; actionRoles: UserRole[] }[]>;
  };
}

export interface RunAutomationInput {
  organizationId: string;
  trigger: NotificationType;
  /** Flat field values the rule's conditions may reference, e.g. `{ sku, categoryName, quantity }` for LOW_STOCK. */
  context: Record<string, string | number>;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

/**
 * WHEN `trigger` fires, IF every one of a rule's conditions matches
 * `context`, THEN notify that rule's configured roles - on top of, not
 * instead of, whatever the event's own default audience already got via a
 * separate `notify()` call at the trigger site. Each condition is a plain
 * field/operator/value comparison; nothing here ever evaluates user-supplied
 * code.
 */
export async function runAutomationRules(client: AutomationClient, input: RunAutomationInput): Promise<void> {
  const rules = await client.automationRule.findMany({
    where: { organizationId: input.organizationId, triggerType: input.trigger, isActive: true },
    select: { id: true, name: true, conditions: true, actionRoles: true },
  });

  for (const rule of rules) {
    if (rule.actionRoles.length === 0 || !conditionsMatch(rule.conditions, input.context)) {
      continue;
    }

    await notify(client, {
      organizationId: input.organizationId,
      type: input.trigger,
      title: `${rule.name}: ${input.title}`,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
      roles: rule.actionRoles,
    });
  }
}

function conditionsMatch(raw: unknown, context: Record<string, string | number>): boolean {
  if (!Array.isArray(raw)) {
    return true;
  }

  return raw.every((entry) => {
    if (!isCondition(entry)) {
      return false;
    }

    const actual = context[entry.field];
    if (actual === undefined) {
      return false;
    }

    switch (entry.operator) {
      case 'EQUALS':
        return String(actual) === entry.value;
      case 'NOT_EQUALS':
        return String(actual) !== entry.value;
      case 'GREATER_THAN':
        return Number(actual) > Number(entry.value);
      case 'LESS_THAN':
        return Number(actual) < Number(entry.value);
      default:
        return false;
    }
  });
}

function isCondition(value: unknown): value is AutomationCondition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.field === 'string' && typeof record.operator === 'string' && typeof record.value === 'string';
}
