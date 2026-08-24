export type ExpenseCategory = 'RENT' | 'UTILITIES' | 'SALARIES' | 'SUPPLIES' | 'MARKETING' | 'MAINTENANCE' | 'TRANSPORT' | 'TAXES' | 'OTHER';
export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
export type PaymentReferenceType = 'ORDER' | 'REPAIR' | 'RETURN';
export type TransactionType = 'SALE' | 'REFUND' | 'EXPENSE' | 'REPAIR_PAYMENT' | 'OTHER_INCOME';
export type TransactionReferenceType = 'ORDER' | 'REPAIR' | 'RETURN' | 'EXPENSE';

export interface FinanceUserRef {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Expense {
  id: string;
  expenseNumber: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
  expenseDate: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  createdBy: FinanceUserRef;
}

export interface FinancePayment {
  id: string;
  paymentNumber: string;
  method: PaymentMethod;
  amount: string;
  referenceType: PaymentReferenceType;
  orderId: string | null;
  repairId: string | null;
  returnId: string | null;
  reference: string | null;
  note: string | null;
  paidAt: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  createdBy: FinanceUserRef;
  order: { id: string; orderNumber: string } | null;
  repair: { id: string; repairNumber: string } | null;
  returnRecord: { id: string; returnNumber: string } | null;
}

export interface FinancialTransaction {
  id: string;
  type: TransactionType;
  amount: string;
  description: string;
  occurredAt: string;
  referenceType: TransactionReferenceType | null;
  referenceId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  createdBy: FinanceUserRef;
}

export interface FinanceSummary {
  from: string | null;
  to: string | null;
  income: {
    sale: string;
    repairPayment: string;
    otherIncome: string;
    total: string;
  };
  refunds: string;
  expenses: {
    byCategory: Record<ExpenseCategory, string>;
    total: string;
  };
  netRevenue: string;
  netPosition: string;
}
