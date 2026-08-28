'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { financeApi, type CreateExpenseInput, type CreateOtherIncomeInput, type UpdateExpenseInput } from '@/features/finance/api';
import { ExpenseFormDialog } from '@/features/finance/components/expense-form-dialog';
import { RecordIncomeDialog } from '@/features/finance/components/record-income-dialog';
import { EXPENSE_CATEGORY_LABELS, TRANSACTION_TYPE_LABELS } from '@/features/finance/labels';
import type { Expense, FinancePayment, FinancialTransaction } from '@/features/finance/types';
import { PAYMENT_METHOD_LABELS } from '@/features/orders/labels';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatDateTime } from '@/lib/format';

const MANAGE_ROLES = new Set(['ADMIN', 'MANAGER']);
const TABS = ['Summary', 'Expenses', 'Payments', 'Transactions'] as const;
type Tab = (typeof TABS)[number];

export default function FinancePage(): React.JSX.Element {
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');
  const [tab, setTab] = useState<Tab>('Summary');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Finance</h1>
        <p className="text-sm text-muted-foreground">Income, refunds, expenses and the money ledger.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          To
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
            className="w-40"
          />
        </label>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTab(value);
            }}
            className={cn(
              'border-b-2 px-3 py-2 text-sm',
              tab === value ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {tab === 'Summary' && <SummaryTab from={from} to={to} />}
      {tab === 'Expenses' && <ExpensesTab canManage={canManage} />}
      {tab === 'Payments' && <PaymentsTab />}
      {tab === 'Transactions' && <TransactionsTab canManage={canManage} />}
    </div>
  );
}

function SummaryTab({ from, to }: { from: string; to: string }): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['finance-summary', from, to],
    queryFn: () => financeApi.summary({ from: from === '' ? undefined : from, to: to === '' ? undefined : to }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (isError || data === undefined) return <p className="text-sm text-danger">{errorMessage(error)}</p>;

  const categoryEntries = Object.entries(data.expenses.byCategory) as [keyof typeof EXPENSE_CATEGORY_LABELS, string][];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Income" value={formatCurrency(data.income.total)} hint={`${formatCurrency(data.income.sale)} sales`} />
        <KpiCard label="Refunds" value={formatCurrency(data.refunds)} />
        <KpiCard label="Expenses" value={formatCurrency(data.expenses.total)} />
        <KpiCard label="Net position" value={formatCurrency(data.netPosition)} hint={`${formatCurrency(data.netRevenue)} net revenue`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Income breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Sales" value={data.income.sale} />
            <Row label="Repair payments" value={data.income.repairPayment} />
            <Row label="Other income" value={data.income.otherIncome} />
            <Row label="Total" value={data.income.total} bold />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expenses by category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {categoryEntries.every(([, amount]) => amount === '0.00') ? (
              <p className="text-muted-foreground">No expenses in this period.</p>
            ) : (
              categoryEntries
                .filter(([, amount]) => amount !== '0.00')
                .map(([category, amount]) => <Row key={category} label={EXPENSE_CATEGORY_LABELS[category]} value={amount} />)
            )}
            <Row label="Total" value={data.expenses.total} bold />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex justify-between', bold && 'font-medium')}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{formatCurrency(value)}</span>
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint !== undefined && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function expenseColumns(canManage: boolean, deleting: boolean, onDelete: (expense: Expense) => void, onEdit: (expense: Expense) => void): DataTableColumn<Expense>[] {
  return [
    { key: 'expenseNumber', label: 'Expense #', render: (expense) => expense.expenseNumber },
    { key: 'category', label: 'Category', render: (expense) => <span className="text-muted-foreground">{EXPENSE_CATEGORY_LABELS[expense.category]}</span> },
    { key: 'description', label: 'Description', render: (expense) => <span className="text-muted-foreground">{expense.description}</span> },
    { key: 'amount', label: 'Amount', align: 'right', render: (expense) => <span className="tabular-nums">{formatCurrency(expense.amount)}</span> },
    { key: 'date', label: 'Date', render: (expense) => <span className="text-muted-foreground">{formatDateTime(expense.expenseDate)}</span> },
    ...(canManage
      ? [
          {
            key: 'actions',
            label: 'Actions',
            align: 'right' as const,
            render: (expense: Expense) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onEdit(expense);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onDelete(expense);
                  }}
                  disabled={deleting}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];
}

function ExpensesTab({ canManage }: { canManage: boolean }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['expenses', page, searchInput],
    queryFn: () => financeApi.listExpenses({ page, search: searchInput }),
  });

  const invalidate = async (): Promise<void> => {
    // Expenses feed into the summary KPIs, so creating/editing/removing one must refresh those too.
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['expenses'] }), queryClient.invalidateQueries({ queryKey: ['finance-summary'] })]);
  };
  const removeMutation = useMutation({ mutationFn: (id: string) => financeApi.removeExpense(id), onSuccess: invalidate });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder="Search by expense # or description"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        {canManage && (
          <Button
            onClick={() => {
              setEditingExpense(null);
              setDialogOpen(true);
            }}
          >
            Record expense
          </Button>
        )}
      </div>

      <DataTable
        columns={expenseColumns(canManage, removeMutation.isPending, (expense) => {
          void removeMutation.mutateAsync(expense.id);
        }, (expense) => {
          setEditingExpense(expense);
          setDialogOpen(true);
        })}
        rows={data?.items ?? []}
        rowKey={(expense) => expense.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No expenses found."
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />

      <ExpenseFormDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        editingExpense={editingExpense}
        onCreate={async (input: CreateExpenseInput) => {
          await financeApi.createExpense(input);
          await invalidate();
        }}
        onUpdate={async (id: string, input: UpdateExpenseInput) => {
          await financeApi.updateExpense(id, input);
          await invalidate();
        }}
      />
    </div>
  );
}

function PaymentsTab(): React.JSX.Element {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['finance-payments', page],
    queryFn: () => financeApi.listPayments({ page, search: '' }),
  });

  return (
    <DataTable
      columns={PAYMENT_COLUMNS}
      rows={data?.items ?? []}
      rowKey={(payment) => payment.id}
      isLoading={isLoading}
      isError={isError}
      error={error}
      emptyMessage="No payments found."
      pagination={
        data === undefined
          ? undefined
          : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
      }
    />
  );
}

const PAYMENT_COLUMNS: DataTableColumn<FinancePayment>[] = [
  { key: 'paymentNumber', label: 'Payment #', render: (payment) => payment.paymentNumber },
  { key: 'method', label: 'Method', render: (payment) => <span className="text-muted-foreground">{PAYMENT_METHOD_LABELS[payment.method]}</span> },
  {
    key: 'source',
    label: 'Source',
    render: (payment) => (
      <span className="text-muted-foreground">
        {payment.order !== null && (
          <Link href={`/dashboard/orders/${payment.order.id}`} className="hover:underline">
            {payment.order.orderNumber}
          </Link>
        )}
        {payment.repair !== null && (
          <Link href={`/dashboard/repairs/${payment.repair.id}`} className="hover:underline">
            {payment.repair.repairNumber}
          </Link>
        )}
        {payment.returnRecord !== null && (
          <Link href={`/dashboard/returns/${payment.returnRecord.id}`} className="hover:underline">
            {payment.returnRecord.returnNumber}
          </Link>
        )}
      </span>
    ),
  },
  { key: 'amount', label: 'Amount', align: 'right', render: (payment) => <span className="tabular-nums">{formatCurrency(payment.amount)}</span> },
  { key: 'paid', label: 'Paid', render: (payment) => <span className="text-muted-foreground">{formatDateTime(payment.paidAt)}</span> },
];

const TRANSACTION_COLUMNS: DataTableColumn<FinancialTransaction>[] = [
  { key: 'type', label: 'Type', render: (transaction) => TRANSACTION_TYPE_LABELS[transaction.type] },
  { key: 'description', label: 'Description', render: (transaction) => <span className="text-muted-foreground">{transaction.description}</span> },
  { key: 'amount', label: 'Amount', align: 'right', render: (transaction) => <span className="tabular-nums">{formatCurrency(transaction.amount)}</span> },
  { key: 'occurred', label: 'Occurred', render: (transaction) => <span className="text-muted-foreground">{formatDateTime(transaction.occurredAt)}</span> },
];

function TransactionsTab({ canManage }: { canManage: boolean }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['finance-transactions', page],
    queryFn: () => financeApi.listTransactions({ page, search: '' }),
  });

  const invalidate = async (): Promise<void> => {
    // Manual transactions feed into the summary KPIs too.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-summary'] }),
    ]);
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            Record other income
          </Button>
        </div>
      )}

      <DataTable
        columns={TRANSACTION_COLUMNS}
        rows={data?.items ?? []}
        rowKey={(transaction) => transaction.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No transactions found."
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />

      <RecordIncomeDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        onSubmit={async (input: CreateOtherIncomeInput) => {
          await financeApi.recordOtherIncome(input);
          await invalidate();
        }}
      />
    </div>
  );
}
