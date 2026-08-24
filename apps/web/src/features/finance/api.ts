import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type {
  Expense,
  ExpenseCategory,
  FinancePayment,
  FinanceSummary,
  FinancialTransaction,
  PaymentMethod,
  PaymentReferenceType,
  TransactionReferenceType,
  TransactionType,
} from './types';

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const suffix = search.toString();
  return suffix === '' ? '' : `?${suffix}`;
}

function withoutEmpty(input: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== '' && value !== undefined));
}

export interface ExpenseListParams {
  page: number;
  search: string;
  category?: ExpenseCategory;
  expenseFrom?: string;
  expenseTo?: string;
}

export interface CreateExpenseInput {
  category: ExpenseCategory;
  description: string;
  amount: string;
  expenseDate?: string;
}

export type UpdateExpenseInput = Partial<CreateExpenseInput>;

export interface PaymentListParams {
  page: number;
  search: string;
  method?: PaymentMethod;
  referenceType?: PaymentReferenceType;
}

export interface TransactionListParams {
  page: number;
  search: string;
  type?: TransactionType;
  referenceType?: TransactionReferenceType;
}

export interface CreateOtherIncomeInput {
  amount: string;
  description: string;
  occurredAt?: string;
}

export interface SummaryParams {
  from?: string;
  to?: string;
}

export const financeApi = {
  listExpenses: ({ page, search, category, expenseFrom, expenseTo }: ExpenseListParams): Promise<PaginatedResult<Expense>> =>
    apiClient.getPaginated<Expense>(`/finance/expenses${query({ page, limit: 20, search, category, expenseFrom, expenseTo })}`),
  createExpense: (input: CreateExpenseInput): Promise<Expense> => apiClient.post<Expense>('/finance/expenses', withoutEmpty(input)),
  updateExpense: (id: string, input: UpdateExpenseInput): Promise<Expense> => apiClient.patch<Expense>(`/finance/expenses/${id}`, withoutEmpty(input)),
  removeExpense: (id: string): Promise<Expense> => apiClient.delete<Expense>(`/finance/expenses/${id}`),

  listPayments: ({ page, search, method, referenceType }: PaymentListParams): Promise<PaginatedResult<FinancePayment>> =>
    apiClient.getPaginated<FinancePayment>(`/finance/payments${query({ page, limit: 20, search, method, referenceType })}`),

  listTransactions: ({ page, search, type, referenceType }: TransactionListParams): Promise<PaginatedResult<FinancialTransaction>> =>
    apiClient.getPaginated<FinancialTransaction>(`/finance/transactions${query({ page, limit: 20, search, type, referenceType })}`),
  recordOtherIncome: (input: CreateOtherIncomeInput): Promise<FinancialTransaction> =>
    apiClient.post<FinancialTransaction>('/finance/transactions', withoutEmpty(input)),

  summary: ({ from, to }: SummaryParams): Promise<FinanceSummary> => apiClient.get<FinanceSummary>(`/finance/summary${query({ from, to })}`),
};
