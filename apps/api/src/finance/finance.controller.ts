import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import { UserRole } from '../generated/prisma/enums';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { CreateOtherIncomeDto } from './dto/create-other-income.dto';
import { ExpenseQueryDto } from './dto/expense-query.dto';
import { FinanceSummaryQueryDto } from './dto/finance-summary-query.dto';
import { FinancialTransactionQueryDto } from './dto/financial-transaction-query.dto';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { FinanceService, type FinanceSummary } from './finance.service';
import type { ExpenseWithCreator, PaymentWithRelations, TransactionWithCreator } from './finance-views';

/**
 * Expenses are a back-office record, so recording, editing and removing one
 * is limited to ADMIN and MANAGER, the same bar as approving a return or
 * taking a repair payment. Reading is open to any authenticated user, like
 * every other module.
 */
@ApiBearerAuth('access-token')
@ApiTags('Finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('expenses')
  @ApiOperation({ summary: 'List expenses with pagination, search and filters' })
  findExpenses(@Query() query: ExpenseQueryDto): Promise<Paginated<ExpenseWithCreator>> {
    return this.financeService.findExpenses(query);
  }

  @Get('expenses/:id')
  @ApiOperation({ summary: 'Get one expense' })
  findExpense(@Param('id', ParseUUIDPipe) id: string): Promise<ExpenseWithCreator> {
    return this.financeService.findExpense(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('expenses')
  @ApiOperation({ summary: 'Record an expense' })
  createExpense(@Body() dto: CreateExpenseDto, @CurrentUser() caller: AuthenticatedUser): Promise<ExpenseWithCreator> {
    return this.financeService.createExpense(dto, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch('expenses/:id')
  @ApiOperation({ summary: 'Correct an expense' })
  updateExpense(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseDto, @CurrentUser() caller: AuthenticatedUser): Promise<ExpenseWithCreator> {
    return this.financeService.updateExpense(id, dto, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete('expenses/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an expense entered by mistake' })
  removeExpense(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<ExpenseWithCreator> {
    return this.financeService.removeExpense(id, caller.id);
  }

  @Get('payments')
  @ApiOperation({ summary: 'List payments recorded across orders, repairs and returns' })
  findPayments(@Query() query: PaymentQueryDto): Promise<Paginated<PaymentWithRelations>> {
    return this.financeService.findPayments(query);
  }

  @Get('payments/:id')
  @ApiOperation({ summary: 'Get one payment' })
  findPayment(@Param('id', ParseUUIDPipe) id: string): Promise<PaymentWithRelations> {
    return this.financeService.findPayment(id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List the financial ledger' })
  findTransactions(@Query() query: FinancialTransactionQueryDto): Promise<Paginated<TransactionWithCreator>> {
    return this.financeService.findTransactions(query);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get one ledger entry' })
  findTransaction(@Param('id', ParseUUIDPipe) id: string): Promise<TransactionWithCreator> {
    return this.financeService.findTransaction(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('transactions')
  @ApiOperation({ summary: 'Record income that did not come from a sale, a repair or a return' })
  recordOtherIncome(@Body() dto: CreateOtherIncomeDto, @CurrentUser() caller: AuthenticatedUser): Promise<TransactionWithCreator> {
    return this.financeService.recordOtherIncome(dto, caller.id);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Income, refunds, expenses and net position over a period' })
  summary(@Query() query: FinanceSummaryQueryDto): Promise<FinanceSummary> {
    return this.financeService.summary(query);
  }
}
