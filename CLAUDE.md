# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stock Pro: a pnpm monorepo — NestJS API (`apps/api`) + Next.js admin dashboard (`apps/web`,
placeholder until Phase 14) — for inventory, sales, repair, supplier, customer, return and
finance management. Multi-tenant (organization-scoped). Being built phase by phase; see
`README.md` for exactly what's delivered (currently through Phase 13 — auth, customers,
suppliers, catalogue, stock, orders, repairs, returns, finance, dashboard, reports, audit,
settings) and what's deliberately deferred.

**`README.md` is the primary reference** — it documents every module's business rules,
concurrency model, money handling, and API conventions in detail. Read the relevant section
before touching a module; don't re-derive rules that are already written down there.

## Commands

Run from the repository root (pnpm workspace).

```
pnpm dev                # all apps, watch mode
pnpm dev:api             # API only
pnpm build               # build every package in dependency order
pnpm lint / lint:fix      # ESLint (flat config) across the monorepo
pnpm typecheck            # root tsc -b + per-package typechecks
pnpm test                 # unit tests (all packages)
pnpm test:e2e             # e2e + database integration tests (needs real DB, see below)
pnpm format / format:check

pnpm db:up / db:down / db:logs / db:status / db:reset   # PostgreSQL 17 in Docker, port 5433
pnpm prisma:migrate / prisma:generate / prisma:studio
pnpm db:seed              # re-runnable dev seed data
```

`pnpm test:e2e` hits the real database, not mocks — start it first:

```
pnpm db:up ; pnpm prisma:migrate ; pnpm db:seed ; pnpm test:e2e
```

### Running a single test (from `apps/api`)

```
pnpm test -- orders.service.spec        # unit test by filename fragment
pnpm test -- -t "confirms an order"     # unit test by test name
npx jest --config ./test/jest-e2e.json --runInBand -t "concurrency"   # single e2e test
```

E2E specs live in `apps/api/test/*.e2e-spec.ts`; unit specs sit next to the code they cover
(`*.service.spec.ts`). `test:e2e` runs `--runInBand` deliberately — several suites (the
`*-concurrency.e2e-spec.ts` files) fire genuinely simultaneous requests at the real database
and assert exact win/loss counts, which would be corrupted by parallel workers.

## Architecture

### Shared TypeScript presets (`packages/tsconfig`)

Four presets with no path-bearing options (`rootDir`, `include`, etc. are set per-package):
`base.json` (strict + `noUncheckedIndexedAccess`), `library.json` (`packages/*`),
`nest.json` (`apps/api` — relaxes `strictPropertyInitialization` only, since DTO fields are
assigned by the validation pipe), `nextjs.json` (`apps/web`).

`packages/shared-types` and `packages/validation` are reserved placeholders (Phases 21, 20).

### Multi-tenancy

Every tenant-scoped table carries `organizationId`, enforced by a **Prisma client extension**
that injects the current org into every query — not manual `where` clauses per call site. The
org comes from the caller's JWT via `JwtAuthGuard`, populated into `AsyncLocalStorage` before
any query runs. A cross-tenant resource returns `404`, not `403` — it's genuinely invisible
from the injected filter's point of view, matching what the row actually looks like to that
query. `apps/api/test/tenant-isolation.e2e-spec.ts` is the place to look for how this is
verified.

### Authorization

Global guard protects every route by default — exposing an endpoint requires explicit
`@Public()`, so a forgotten guard fails closed. `@Roles(...)` narrows further. Roles:
`ADMIN`, `MANAGER`, `STAFF`, `TECHNICIAN`. Role lives in the access token, so a role change
takes effect on next refresh (15 min), while deactivation is immediate (revokes refresh
tokens).

### Money

Exact decimal strings end to end — never floating point. Prices are validated as strings
(≤2 decimal places), passed to Prisma as strings, stored as `Decimal(14, 2)`, returned as
fixed two-decimal strings via `serialiseDecimalsAsFixedStrings()`. Every module's totals are
pure functions with no DB client (`order-totals.ts`, `return-refunds.ts`) so the arithmetic
is directly testable.

### Concurrency: conditional UPDATE, never read-then-write

Every stock and state-transition change in the whole codebase follows the same pattern — a
single conditional `UPDATE ... WHERE <still-valid-state>` that re-evaluates against whatever
committed first, rather than a JS-level check followed by a write. This is how stock levels,
order/repair/return status transitions, and payment totals all stay race-safe under real
concurrent load. Shared stock-adjustment logic lives in
`apps/api/src/common/inventory/stock-operations.ts` and is reused by orders, repairs and
returns rather than reimplemented per module. When touching any of those modules, follow this
pattern — don't introduce a read-modify-write.

Each of orders, repairs, returns and stock has a dedicated `*-concurrency.e2e-spec.ts` that
fires simultaneous requests at the real DB and asserts exact success/failure counts — these
are the tests to run after changing anything in the reservation/completion/payment paths.

### One financial ledger

`FinancialTransaction` is fed by every module that moves money (order payments, repair
payments, return refunds, expenses) in the same transaction as the write that earns the
entry — never re-derived by joining source tables later. The only entry a caller can write
directly is `OTHER_INCOME`; every other type is system-derived. Dashboard and reports reuse
`FinanceService.summary()` / `StockService` rather than recomputing figures.

### API conventions

Every response is wrapped in an envelope (`{ data, meta }` on success,
`{ statusCode, code, message, errors, requestId, path, timestamp }` on failure — clients
branch on `code`, never `message`). See `README.md`'s "API conventions" section for the full
shape. List endpoints share `page`/`limit`/`sortOrder`/`search` query params, with `sortBy`
always restricted to a per-module whitelist (never an open column name).

### Prisma

Client generates into `apps/api/src/generated/prisma` (not committed — regenerated via
`postinstall`). Prisma 7 connects through `@prisma/adapter-pg`; connection config is in
`apps/api/prisma.config.ts`, which loads the repo-root `.env`. Invariants the schema
language can't express (non-negative stock, reserved ≤ on-hand, positive quantities) are
PostgreSQL check constraints in the initial migration — the last line of defence behind
application logic.
