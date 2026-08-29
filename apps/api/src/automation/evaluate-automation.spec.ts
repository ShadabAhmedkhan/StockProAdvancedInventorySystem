import { NotificationType, UserRole } from '../generated/prisma/enums';
import { runAutomationRules } from './evaluate-automation';

const ORG_ID = 'org-1';

function fakeClient(rules: { id: string; name: string; conditions: unknown; actionRoles: UserRole[] }[]) {
  const findManyRules = jest.fn(() => Promise.resolve(rules));
  const findManyUsers = jest.fn(() => Promise.resolve([{ id: 'user-1' }]));
  const createMany = jest.fn(() => Promise.resolve({ count: 1 }));

  return {
    client: {
      automationRule: { findMany: findManyRules },
      user: { findMany: findManyUsers },
      notification: { createMany },
    },
    findManyUsers,
    createMany,
  };
}

describe('runAutomationRules', () => {
  it('fires the action when every condition matches', async () => {
    const { client, createMany } = fakeClient([
      {
        id: 'rule-1',
        name: 'Notify on laptop low stock',
        conditions: [{ field: 'categoryName', operator: 'EQUALS', value: 'Laptop' }],
        actionRoles: [UserRole.MANAGER],
      },
    ]);

    await runAutomationRules(client, {
      organizationId: ORG_ID,
      trigger: NotificationType.LOW_STOCK,
      context: { categoryName: 'Laptop', quantity: 2 },
      title: 'Low stock',
      message: 'Widget is low on stock',
    });

    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('does not fire when a condition does not match', async () => {
    const { client, createMany } = fakeClient([
      {
        id: 'rule-1',
        name: 'Notify on laptop low stock',
        conditions: [{ field: 'categoryName', operator: 'EQUALS', value: 'Laptop' }],
        actionRoles: [UserRole.MANAGER],
      },
    ]);

    await runAutomationRules(client, {
      organizationId: ORG_ID,
      trigger: NotificationType.LOW_STOCK,
      context: { categoryName: 'Phone', quantity: 2 },
      title: 'Low stock',
      message: 'Widget is low on stock',
    });

    expect(createMany).not.toHaveBeenCalled();
  });

  it('evaluates numeric operators by number, not string order', async () => {
    const { client, createMany } = fakeClient([
      { id: 'rule-1', name: 'Big orders', conditions: [{ field: 'total', operator: 'GREATER_THAN', value: '9' }], actionRoles: [UserRole.ADMIN] },
    ]);

    // "10" < "9" as strings, but 10 > 9 as numbers - this is exactly the bug a naive string comparison would hide.
    await runAutomationRules(client, {
      organizationId: ORG_ID,
      trigger: NotificationType.ORDER_COMPLETED,
      context: { total: 10 },
      title: 'Order completed',
      message: 'Order completed',
    });

    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('treats an empty condition list as always matching', async () => {
    const { client, createMany } = fakeClient([{ id: 'rule-1', name: 'Always notify', conditions: [], actionRoles: [UserRole.ADMIN] }]);

    await runAutomationRules(client, {
      organizationId: ORG_ID,
      trigger: NotificationType.ORDER_COMPLETED,
      context: { total: 1 },
      title: 'Order completed',
      message: 'Order completed',
    });

    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('skips a rule with no configured recipients rather than calling notify with nobody to notify', async () => {
    const { client, createMany } = fakeClient([{ id: 'rule-1', name: 'Broken rule', conditions: [], actionRoles: [] }]);

    await runAutomationRules(client, {
      organizationId: ORG_ID,
      trigger: NotificationType.ORDER_COMPLETED,
      context: { total: 1 },
      title: 'Order completed',
      message: 'Order completed',
    });

    expect(createMany).not.toHaveBeenCalled();
  });

  it('ignores a rule for a different trigger type', async () => {
    // The findMany call itself is what filters by trigger + isActive server-side;
    // this only proves the function passes those through rather than filtering client-side.
    const findManyRules = jest.fn(() => Promise.resolve([]));
    const client = {
      automationRule: { findMany: findManyRules },
      user: { findMany: jest.fn(() => Promise.resolve([])) },
      notification: { createMany: jest.fn(() => Promise.resolve({ count: 0 })) },
    };

    await runAutomationRules(client, {
      organizationId: ORG_ID,
      trigger: NotificationType.REPAIR_READY,
      context: {},
      title: 'x',
      message: 'y',
    });

    expect(findManyRules).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, triggerType: NotificationType.REPAIR_READY, isActive: true },
      select: { id: true, name: true, conditions: true, actionRoles: true },
    });
  });
});
