# StockPro — Production SaaS Evolution, UX Redesign & Feature Expansion

You are working inside the existing **StockPro monorepo**.

Your job is NOT to rebuild the application from scratch.

Your job is to audit, strengthen, redesign and progressively extend the existing system while preserving all validated business invariants.

---

# 1. Existing Product

StockPro is a multi-tenant SaaS inventory, sales, repair and finance management platform for retail and repair businesses.

Monorepo:

```text
apps/api/        NestJS REST API
apps/web/        Next.js App Router dashboard

packages/
  tsconfig/
  eslint-config/
  shared-types/
  validation/

infrastructure/
  PostgreSQL Docker setup
```

Technology:

* pnpm workspaces
* TypeScript
* NestJS
* Prisma 7
* @prisma/adapter-pg
* PostgreSQL 17
* Next.js App Router
* Tailwind CSS
* shadcn/ui
* TanStack Query
* React Hook Form
* Zod
* Recharts
* Jest
* Supertest
* Vitest
* Playwright

---

# 2. Critical Existing Architecture

Do not weaken or bypass these rules.

## Multi-tenancy

Every tenant-owned record uses:

```text
organizationId
```

Tenant context is populated from authenticated JWT data using AsyncLocalStorage.

A Prisma client extension automatically applies organization filtering.

Cross-tenant resources must behave as nonexistent and return:

```text
404
```

Never expose cross-tenant existence using 403.

Do not manually work around tenant scoping.

---

# 3. Authentication

Access token:

* JWT
* short lived
* approximately 15 minutes
* returned through response body

Refresh token:

* cryptographically random opaque token
* HTTP-only cookie
* rotated every use
* reuse detection revokes the entire session

Password hashing:

```text
Argon2id
```

Roles:

```text
ADMIN
MANAGER
STAFF
TECHNICIAN
```

Authorization is deny-by-default.

Routes explicitly opt in using mechanisms such as:

```text
@Public()
@Roles(...)
```

Never weaken this authorization model.

---

# 4. Billing

New organizations receive a 14-day trial.

Stripe manages:

* checkout
* subscription
* customer portal
* webhook synchronization

When:

```text
trial expired
AND
subscription inactive
```

the organization receives HTTP 402 for protected product functionality.

Authentication and billing recovery endpoints remain accessible.

Preserve this behavior.

---

# 5. Financial Invariants

Never use JavaScript floating-point arithmetic for currency.

Use:

```text
Decimal(14,2)
```

All totals must continue to use pure deterministic domain functions.

Existing examples include:

```text
order-totals.ts
return-refunds.ts
```

FinancialTransaction is the single financial ledger.

Money-moving workflows must create their financial transaction in the same database transaction as the business operation.

Direct manual ledger posting is restricted to permitted OTHER_INCOME behavior.

---

# 6. Inventory Invariants

Inventory quantity must never become negative.

Reserved quantity must never exceed valid available stock.

Never implement:

```text
read current stock
modify in JavaScript
write new stock
```

Stock/status concurrency must remain implemented through atomic conditional SQL/database updates such as:

```text
UPDATE ...
WHERE current_state_is_still_valid
```

Every inventory quantity mutation must create its corresponding:

```text
StockMovement
```

inside the same transaction.

Inventory must remain reconstructable from its ledger.

Existing concurrency tests must continue passing.

---

# 7. Existing Modules

Delivered backend business areas include:

* Authentication
* Organizations
* Users
* Customers
* Suppliers
* Categories
* Brands
* Products
* Inventory
* Stock movements
* Orders
* Payments
* Repairs
* Repair parts
* Returns
* Refunds
* Expenses
* Finance ledger
* Dashboard
* Reports
* Audit
* Settings
* Billing

Frontend currently contains functional pages/workflows for:

* Dashboard
* Audit
* Billing
* Finance
* Inventory
* Orders
* Products
* Repairs
* Returns
* Reports
* Settings
* Users
* organization/platform administration

Do not remove working functionality.

---

# 8. Current Missing Production Work

Before large new business modules, review and complete:

1. Password reset
2. Full API E2E coverage
3. Full Playwright coverage
4. Security review
5. Performance review
6. Production build hardening
7. deployment/environment validation
8. observability review
9. accessibility review
10. responsive UX review

These take priority over speculative feature development.

---

# 9. PHASE 24 — Deep Architecture Audit

Before editing code, inspect the repository.

Review:

## Backend

* NestJS module boundaries
* Prisma schema
* migrations
* database constraints
* database indexes
* transaction boundaries
* tenant filtering
* AsyncLocalStorage tenant context
* JwtAuthGuard
* role decorators
* billing guards
* refresh-token rotation
* request validation
* error filters
* audit writes
* ledger writes
* concurrency logic
* duplicate database queries
* N+1 queries
* pagination
* filtering
* sorting
* reporting queries

## Frontend

Review:

* app router structure
* route groups
* layouts
* providers
* API client
* authentication handling
* query keys
* mutation invalidation
* forms
* dialogs
* tables
* loading states
* error states
* empty states
* responsive design
* accessibility
* duplicated components
* duplicated validation
* design consistency
* bundle size
* rendering boundaries

## Testing

Review:

* API unit tests
* API E2E tests
* concurrency tests
* frontend Vitest tests
* Playwright tests
* tenant-isolation tests
* authorization tests
* billing tests

Produce an audit report before major architectural modifications.

Categorize findings:

```text
CRITICAL
HIGH
MEDIUM
LOW
DESIGN
PERFORMANCE
SECURITY
MAINTAINABILITY
TESTING
```

Do not manufacture issues.

Only report issues supported by the repository.

---

# 10. PHASE 25 — Password Recovery

Implement a production-grade password recovery flow.

Required workflow:

```text
Forgot Password
      ↓
Generate secure reset token
      ↓
Store only hashed token
      ↓
Send reset link
      ↓
Validate token
      ↓
Set new password
      ↓
Invalidate token
      ↓
Revoke existing sessions
```

Requirements:

* cryptographically secure token
* hashed token in database
* expiration
* one-time usage
* generic response preventing email enumeration
* request throttling
* Argon2id password hashing
* audit event
* revoke existing refresh sessions after password reset
* frontend forgot-password page
* frontend reset-password page
* success/failure states
* tests

Use an email-provider abstraction so the application is not permanently coupled to one provider.

---

# 11. PHASE 26 — Production Hardening

Review and improve:

* security headers
* CSP
* CORS
* cookie security
* trusted proxy configuration
* rate limiting
* body-size limits
* request timeout strategy
* graceful shutdown
* database connection handling
* structured logging
* request IDs
* health endpoints
* readiness checks
* liveness checks
* secrets validation
* environment schemas
* Stripe webhook validation
* production source maps
* build configuration
* Docker configuration
* database migration deployment
* startup failure handling

Do not expose sensitive information in production logs or API errors.

---

# 12. PHASE 27 — Premium StockPro Design System

Redesign the product into a polished enterprise SaaS interface.

Do NOT merely add gradients, excessive shadows or oversized cards.

The product should feel inspired by the usability quality of products such as:

* Stripe
* Linear
* Shopify Admin
* Vercel
* Ramp

Do not copy their branding or layouts directly.

Create a coherent StockPro design language.

## Foundations

Define:

* typography scale
* spacing system
* radius system
* border system
* semantic colors
* surfaces
* elevation
* focus states
* interactive states
* status colors
* chart tokens
* light theme
* dark theme

Prefer CSS variables/design tokens.

---

# 13. App Shell

Build a polished responsive application shell containing:

```text
Organization / Location Selector

Primary Navigation

Global Search

Command Palette

Quick Create

Notifications

User Menu

Breadcrumbs

Contextual Page Actions
```

Sidebar:

```text
Overview

Sales
  Orders
  POS
  Returns

Inventory
  Products
  Stock
  Transfers
  Stock Counts

Purchasing
  Purchase Orders
  Receiving
  Suppliers

Repairs
  Repair Jobs
  Technicians

Customers

Finance
  Transactions
  Expenses

Analytics
  Dashboard
  Reports

Administration
  Users
  Audit
  Settings
  Billing
```

Navigation visibility must respect permissions.

---

# 14. Command Palette

Implement:

```text
Ctrl + K
Cmd + K
```

Potential commands:

```text
Create Order
Create Customer
Create Product
New Repair
Adjust Stock
Create Expense
Go to Inventory
Go to Reports
Search customer
Search order
Search product
```

Commands must still enforce backend authorization.

---

# 15. Data Table System

Create a reusable enterprise data-table pattern.

Support where appropriate:

* server pagination
* search
* filters
* sorting
* column visibility
* density
* saved views
* row selection
* bulk operations
* sticky headers
* contextual row menu
* responsive behavior

Avoid loading huge datasets client-side.

---

# 16. Standard Page UX

Every major page should deliberately implement:

```text
Loading
Skeleton
Empty
Populated
Filtered-empty
Permission denied
API error
Network error
Mutation pending
Mutation success
Mutation failure
```

Avoid unexpected layout movement.

---

# 17. PHASE 30 — Purchase Orders

Add a procurement module.

Core entities should model concepts such as:

```text
PurchaseOrder
PurchaseOrderItem
GoodsReceipt
GoodsReceiptItem
```

Suggested lifecycle:

```text
DRAFT
   ↓
APPROVED
   ↓
ORDERED
   ↓
PARTIALLY_RECEIVED
   ↓
RECEIVED
```

Alternative exit:

```text
CANCELLED
```

Support:

* supplier
* expected date
* item quantity
* unit cost
* discount
* tax
* shipping
* notes
* attachments
* partial receiving
* purchasing history
* audit trail

Do not update inventory when a PO is merely created.

Inventory changes only when goods are actually received.

Goods receipt and StockMovement must remain atomic.

---

# 18. PHASE 32 — Locations / Branches

Introduce inventory locations without breaking organization isolation.

Concept:

```text
Organization
   ↓
Location
   ↓
Inventory
```

Possible location types:

```text
STORE
WAREHOUSE
SERVICE_CENTER
```

Users may have location access restrictions.

Existing organization authorization remains the outer security boundary.

---

# 19. PHASE 33 — Stock Transfers

Add:

```text
StockTransfer
StockTransferItem
```

Lifecycle:

```text
DRAFT
REQUESTED
APPROVED
IN_TRANSIT
COMPLETED
CANCELLED
```

A completed transfer should maintain exact stock ledger entries on both sides.

Never create or destroy inventory accidentally during transfer.

Concurrency requirements must be tested.

---

# 20. PHASE 34 — Barcode / Serial / IMEI

Extend catalogue/inventory where appropriate to support:

* SKU
* barcode
* serial number
* IMEI
* model
* variant
* color
* storage
* condition
* warranty metadata

Do not force serial tracking onto every product.

Support product-level tracking strategy, for example:

```text
NONE
SERIAL
IMEI
```

Enforce appropriate uniqueness constraints.

Provide scanner-friendly UX.

---

# 21. PHASE 35 — Physical Stock Counts

Implement:

```text
StockCount
StockCountItem
```

Lifecycle:

```text
DRAFT
COUNTING
REVIEW
APPROVED
COMPLETED
CANCELLED
```

Support:

* blind counting
* expected quantity
* counted quantity
* variance
* recount
* approvals
* audit
* generated stock adjustments

Approved variance adjustments must produce StockMovement records atomically.

---

# 22. PHASE 36 — Reorder Management

Add product/location inventory planning fields such as:

```text
reorderPoint
targetStock
safetyStock
supplierLeadTime
preferredSupplier
```

Calculate:

```text
available stock
reserved stock
incoming stock
average demand
lead time
```

Expose:

```text
Suggested Reorder Quantity
```

Keep the first implementation deterministic.

Do not introduce AI for basic reorder mathematics.

---

# 23. PHASE 37 — POS

Build an extremely fast sales interface.

Optimize for keyboard and barcode operation.

Workflow:

```text
Scan/Search
     ↓
Cart
     ↓
Customer
     ↓
Discount
     ↓
Payment
     ↓
Receipt
```

Support architecture for:

* cash
* card
* split payments
* held sales
* resumed sales
* barcode scanning
* receipt printing

Reuse the existing Order domain wherever possible.

Do not create a second unrelated sales ledger.

---

# 24. PHASE 38 — Notification Center

Create an internal notification model.

Possible events:

```text
LOW_STOCK
OUT_OF_STOCK
REPAIR_READY
REPAIR_OVERDUE
ORDER_COMPLETED
PURCHASE_RECEIVED
TRIAL_EXPIRING
SUBSCRIPTION_PAYMENT_FAILED
```

UI:

* notification dropdown
* notification page
* unread count
* mark read
* mark all read
* filters

Keep delivery channels abstract.

---

# 25. PHASE 39 — Automation Rules

Create an event-driven automation system.

Concept:

```text
WHEN
event happens

IF
optional conditions match

THEN
perform allowed action
```

Example:

```text
WHEN inventory.low_stock
IF product.category = "Laptop"
THEN notify MANAGER
```

Do not let arbitrary user-defined code execute.

Use controlled trigger/action definitions.

---

# 26. PHASE 40 — Advanced Analytics

Expand analytics to provide:

## Sales

* revenue
* gross profit
* margin
* average order value
* order count
* discount rate
* return rate

## Inventory

* inventory value
* stock turnover
* dead stock
* aging
* low stock
* out of stock
* inventory by category/location

## Purchasing

* supplier spend
* lead time
* cost changes
* supplier performance

## Repairs

* turnaround time
* completion rate
* technician workload
* repair revenue

## Finance

* cash collected
* expenses
* refunds
* net cash flow

Every important chart should support navigation into underlying records where useful.

---

# 27. PHASE 41 — Customer CRM

Extend customers carefully with features such as:

* purchase history
* repair history
* lifetime value
* outstanding activity
* notes
* tags
* addresses
* customer activity timeline

Potential later extensions:

* loyalty points
* store credit

Store credit must use a proper ledger rather than a mutable balance-only implementation.

---

# 28. PHASE 42 — StockPro Intelligence

Only introduce AI after deterministic business systems are reliable.

Do NOT create a generic chatbot with direct unrestricted database access.

Create a permission-aware StockPro AI tool layer.

Example tools:

```text
getSalesSummary
getInventorySummary
getLowStock
getInventoryAging
getTopProducts
getSlowProducts
getFinanceSummary
getRepairSummary
getSupplierPerformance
getReorderSuggestions
```

The AI layer must inherit:

* organization isolation
* location access
* role permissions

Example questions:

```text
Which products should I reorder?

Why did revenue decrease this month?

Which products have not sold for 90 days?

Which supplier has the strongest margin?

What products are being returned most often?

How much cash was actually collected this month?
```

AI recommendations must distinguish:

```text
Observed Fact
Calculated Metric
Recommendation
```

Never allow the model to invent financial or inventory data.

---

# 29. Testing Requirement for Every Phase

Every phase must add appropriate tests.

Backend:

```text
unit
integration
E2E
tenant isolation
RBAC
failure cases
concurrency
```

Frontend:

```text
Vitest
component behavior
validation
loading/error states
```

Full stack:

```text
Playwright
```

Important business workflows should be tested against a real PostgreSQL test database where database semantics matter.

Mocks must not replace tests intended to validate:

* transactions
* constraints
* locking
* isolation
* concurrency

---

# 30. Performance Requirements

Review every major endpoint for:

* database round trips
* missing indexes
* unbounded queries
* N+1 behavior
* unnecessary joins
* unnecessary serialization
* expensive counts
* large payloads

Use database aggregation when appropriate.

Never load an entire table into Node.js merely to calculate an aggregate that PostgreSQL can calculate.

---

# 31. Development Rules

Do not:

* rebuild the repository from scratch
* replace stable architecture without evidence
* break API compatibility unnecessarily
* weaken tenant isolation
* weaken RBAC
* use floating point for money
* perform unsafe read-modify-write stock mutations
* bypass StockMovement
* bypass FinancialTransaction
* duplicate the sales domain for POS
* hide TypeScript errors
* use `any` as a shortcut
* silence ESLint simply to pass CI
* add placeholder code
* leave TODO implementations presented as complete
* introduce speculative abstractions with no current use

Prefer:

```text
small cohesive modules
clear domain boundaries
database-enforced invariants
pure domain calculations
shared reusable components
explicit types
predictable APIs
real tests
incremental migrations
```

---

# 32. Claude Code Execution Protocol

Work one phase at a time.

Before modifying each phase:

1. inspect relevant code
2. inspect Prisma models
3. inspect migrations
4. inspect tests
5. identify existing patterns
6. determine affected files
7. identify regression risks

Then present:

```text
PHASE
Current State
Problems Found
Architecture Decision
Database Changes
Backend Changes
Frontend Changes
Testing Changes
Files Affected
Risks
```

After that, implement the phase.

After implementation run the relevant:

```text
format
lint
typecheck
unit tests
API E2E tests
web tests
Playwright tests
build
```

Do not claim success unless the command actually passes.

When a test fails:

1. inspect the failure
2. identify root cause
3. fix the underlying issue
4. rerun the smallest relevant suite
5. rerun regression tests

Do not modify a test merely to make incorrect application behavior pass.

---

# 33. First Task

Do NOT begin Purchase Orders, AI, POS or any other major new feature yet.

Start with:

```text
PHASE 24 — STOCKPRO DEEP PRODUCTION READINESS AUDIT
```

Inspect the actual repository.

Compare implementation against this specification.

Produce a detailed evidence-based report containing:

```text
1. Architecture findings
2. Security findings
3. Multi-tenancy findings
4. Authentication findings
5. Authorization findings
6. Billing findings
7. Database findings
8. Concurrency findings
9. Finance integrity findings
10. Inventory integrity findings
11. API findings
12. Frontend findings
13. UI/UX findings
14. Accessibility findings
15. Performance findings
16. Testing gaps
17. Production-readiness gaps
18. Technical debt
19. Recommended fixes
20. Exact next implementation phase
```

For every issue include:

```text
Severity
Evidence
Affected files
Why it matters
Recommended correction
Regression risk
Required tests
```

Do not modify code during the initial audit unless a critical issue prevents repository inspection.

Finish by producing a prioritized implementation backlog:

```text
P0 — must fix before production
P1 — important
P2 — product improvement
P3 — future enhancement
```

Preserve all existing validated behavior and existing business invariants.
