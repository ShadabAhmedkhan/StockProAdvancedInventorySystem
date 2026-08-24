import type { ExpenseCategory, TransactionType } from './types';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: 'Rent',
  UTILITIES: 'Utilities',
  SALARIES: 'Salaries',
  SUPPLIES: 'Supplies',
  MARKETING: 'Marketing',
  MAINTENANCE: 'Maintenance',
  TRANSPORT: 'Transport',
  TAXES: 'Taxes',
  OTHER: 'Other',
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  SALE: 'Sale',
  REFUND: 'Refund',
  EXPENSE: 'Expense',
  REPAIR_PAYMENT: 'Repair payment',
  OTHER_INCOME: 'Other income',
};
