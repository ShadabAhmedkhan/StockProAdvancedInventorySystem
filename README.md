# Stock Pro

Stock Pro is a full-stack inventory, sales, repair, supplier, customer, return and finance
management platform, built as a pnpm monorepo with a NestJS API and a Next.js admin dashboard.

**Status:** under active construction. This repository is being built phase by phase.
See [Build status](#build-status) for exactly what exists today.

---

## Business areas

Authentication · Users · Dashboard · Customers · Suppliers · Products · Stock / Inventory ·
Orders / Sales · Repairs · Returns · Finance · Reports · Audit history · Settings

---

## Architecture

```text
stock-pro/
├── apps/
│   ├── api/                  NestJS REST API (TypeScript, Prisma, PostgreSQL)
│   │   ├── prisma/           schema.prisma, migrations, seed
│   │   ├── src/auth/         Registration, login, refresh rotation, logout
│   │   ├── src/common/       Guards, decorators, filters, interceptors, pagination
│   │   ├── src/config/       Environment validation and typed app config
│   │   ├── src/brands/       Brand CRUD
│   │   ├── src/categories/   Category CRUD
│   │   ├── src/customers/    Customer CRUD with soft delete
│   │   ├── src/products/     Product catalogue
│   │   ├── src/stock/        Inventory levels and the movement ledger
│   │   ├── src/suppliers/    Supplier CRUD with soft delete
│   │   ├── src/health/       Liveness and readiness probes
│   │   ├── src/prisma/       PrismaService and the global PrismaModule
│   │   ├── src/users/        User administration and RBAC
│   │   └── test/             End-to-end and database integration suites
│   └── web/                  Next.js App Router admin dashboard                -> Phase 14
├── packages/
│   ├── shared-types/         Framework-neutral shared types                    -> Phase 21
│   ├── validation/           Zod schemas shared by API and web                 -> Phase 20
│   ├── eslint-config/        Shared ESLint flat-config presets
│   └── tsconfig/             Shared TypeScript compiler presets
├── infrastructure/           Docker Compose (PostgreSQL 17)
├── eslint.config.mjs         Root ESLint config (governs every package)
├── prettier.config.mjs       Root Prettier config
├── tsconfig.json             Root TypeScript solution file
├── pnpm-workspace.yaml
├── package.json
└── .env.example
```

| Layer    | Technology                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Monorepo | pnpm workspaces, TypeScript, ESLint 9 (flat config), Prettier                                        |
| Backend  | NestJS, Prisma, PostgreSQL, JWT (access + rotating refresh), Argon2, class-validator, Swagger        |
| Frontend | Next.js (App Router), React, Tailwind CSS, shadcn/ui, React Hook Form, Zod, TanStack Query, Recharts |
| Testing  | Jest + Supertest (API), Playwright (web E2E)                                                         |

### Shared TypeScript presets

`@stock-pro/tsconfig` exposes four presets. They deliberately contain no path-bearing
options (`rootDir`, `outDir`, `include`, …) because TypeScript resolves those relative to the
file that declares them; each package sets its own paths.

| Preset         | Used by                     | Notes                                                                                                                                                                                               |
| -------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base.json`    | everything (via the others) | `strict` plus `noUncheckedIndexedAccess`, `noImplicitReturns`, and friends                                                                                                                          |
| `library.json` | `packages/*`                | Adds `composite` for project references                                                                                                                                                             |
| `nest.json`    | `apps/api`                  | Adds decorator metadata; relaxes `strictPropertyInitialization` only, because NestJS DTO fields are assigned by the validation pipe (the alternative is a non-null assertion on every DTO property) |
| `nextjs.json`  | `apps/web`                  | DOM libs, `jsx: preserve`, `noEmit`                                                                                                                                                                 |

---

## Requirements

| Tool           | Version                                         |
| -------------- | ----------------------------------------------- |
| Node.js        | >= 22                                           |
| pnpm           | >= 10                                           |
| Docker Desktop | any recent (for local PostgreSQL, from Phase 2) |

Enable pnpm with either:

```powershell
corepack enable pnpm      # requires an elevated shell on Windows
npm install -g pnpm@10    # user-level alternative
```

---

## Installation

```powershell
git clone <repository-url> stock-pro
cd stock-pro
pnpm install
```

---

## Environment configuration

```powershell
Copy-Item .env.example .env
```

Then fill in the blanks. `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be strong and
distinct; generate them with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`.env` is git-ignored. Never commit real secrets. The API validates required environment
variables on startup and refuses to boot if any are missing or weak.

---

## Database

PostgreSQL 17 runs in Docker. The container publishes on **5433**, not 5432, so it does not
collide with a natively installed PostgreSQL - a half-bound port produces confusing
authentication failures rather than a clean error.

```powershell
pnpm db:up        # start PostgreSQL and wait until healthy
pnpm db:status    # container status
pnpm db:logs      # follow logs
pnpm db:down      # stop (data is preserved in the named volume)
pnpm db:reset     # stop and DELETE the volume
```

### Prisma

```powershell
pnpm prisma:migrate    # create/apply migrations in development
pnpm prisma:generate   # regenerate the client (also runs on pnpm install)
pnpm db:seed           # load development seed data
pnpm prisma:studio     # browse the data
```

Deployments apply migrations with `pnpm --filter @stock-pro/api prisma:deploy`, which never
generates or resets anything.

The Prisma client is generated into `apps/api/src/generated/prisma` and is **not committed**;
a `postinstall` hook regenerates it, so a fresh clone can typecheck and build immediately.

Prisma 7 connects through a driver adapter (`@prisma/adapter-pg`); `PrismaService` builds it
from `DATABASE_URL`. Connection settings live in `apps/api/prisma.config.ts`, which loads the
repository-root `.env`.

### Seed data

`pnpm db:seed` is re-runnable: every record is keyed on a natural identifier and either
upserted or skipped, so running it twice does not duplicate orders or inflate stock. It
creates 5 users, 8 customers, 4 suppliers, 5 categories, 6 brands, 20 products with opening
stock and matching stock movements, 6 orders, 4 repairs with status history, and 8 expenses.
Some products are seeded at zero or below their minimum so the low-stock and out-of-stock
views have real data.

| Account                 | Role       |
| ----------------------- | ---------- |
| `admin@stockpro.test`   | ADMIN      |
| `manager@stockpro.test` | MANAGER    |
| `staff1@stockpro.test`  | STAFF      |
| `staff2@stockpro.test`  | STAFF      |
| `tech@stockpro.test`    | TECHNICIAN |

All seeded accounts share the password `Password123!`.

> These credentials are for local development only. They must never be used as production
> defaults; a production deployment creates its first administrator through the registration
> endpoint, not by running this seed.

### Schema notes

- Money is `Decimal(14, 2)` everywhere. Floating point is never used for monetary values.
- `deletedAt` exists only on rows that historical records point at (customers, suppliers,
  categories, brands, products). Transactional records use a status instead.
- `Inventory` is separate from `Product` so a price edit never contends with a sale, and
  every change to `Inventory.quantity` is accompanied by a `StockMovement` row - the current
  level is always reconstructable from the ledger.
- Invariants the Prisma schema language cannot express are enforced as PostgreSQL check
  constraints in the initial migration: stock can never go negative, reserved stock can never
  exceed stock on hand, quantities are positive, monetary amounts are non-negative, and a
  payment must point at exactly one subject matching its `referenceType`. These are the last
  line of defence behind the application's transactional logic.

---

## Commands

Run from the repository root.

| Command                                                         | Description                                         |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `pnpm dev`                                                      | Run every app in watch mode                         |
| `pnpm dev:api`                                                  | Run the API only                                    |
| `pnpm dev:web`                                                  | Run the web app only                                |
| `pnpm build`                                                    | Build every workspace package in dependency order   |
| `pnpm lint` / `pnpm lint:fix`                                   | ESLint across the monorepo, optionally with autofix |
| `pnpm typecheck`                                                | TypeScript project build + per-package typechecks   |
| `pnpm test`                                                     | Unit tests                                          |
| `pnpm test:e2e`                                                 | End-to-end and database integration tests           |
| `pnpm format` / `pnpm format:check`                             | Prettier write / check                              |
| `pnpm db:up` / `db:down` / `db:logs` / `db:status` / `db:reset` | Local PostgreSQL lifecycle                          |
| `pnpm prisma:migrate` / `prisma:generate` / `prisma:studio`     | Prisma workflow                                     |
| `pnpm db:seed`                                                  | Load development seed data                          |

`pnpm test:e2e` runs against the real database rather than mocks, so start it first:

```powershell
pnpm db:up ; pnpm prisma:migrate ; pnpm db:seed ; pnpm test:e2e
```

---

## URLs

| Service         | URL                                      |
| --------------- | ---------------------------------------- |
| Web dashboard   | http://localhost:3000                    |
| API base        | https://inventory.boomerce.com//api/v1             |
| Swagger UI      | https://inventory.boomerce.com//api/docs           |
| OpenAPI JSON    | https://inventory.boomerce.com//api/docs-json      |
| Readiness probe | https://inventory.boomerce.com//api/v1/health      |
| Liveness probe  | https://inventory.boomerce.com//api/v1/health/live |

Swagger is served everywhere except production; set `SWAGGER_ENABLED` to override.

---

## API conventions

Every successful response is wrapped in the same envelope:

```json
{
  "data": {},
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

List endpoints add `page`, `limit`, `total` and `totalPages` to `meta`.

Every failure returns:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "errors": [{ "field": "email", "constraints": ["email must be an email"] }],
  "requestId": "...",
  "path": "/api/v1/customers",
  "timestamp": "..."
}
```

Clients branch on the stable `code`, never on `message`. Stack traces are logged
server-side and never sent to the client; in production the message of an unhandled
error is replaced by a generic one.

Every request carries a correlation id. Send `x-request-id` and it is echoed back
(when it is 8-128 characters of `A-Za-z0-9._-`); otherwise the API generates one. It
appears on the response header, in `meta.requestId`, in error bodies, and in every
server log line for that request.

---

## Authentication

| Endpoint                     | Auth           | Purpose                                      |
| ---------------------------- | -------------- | -------------------------------------------- |
| `POST /api/v1/auth/register` | public         | Create an account and sign in                |
| `POST /api/v1/auth/login`    | public         | Sign in                                      |
| `POST /api/v1/auth/refresh`  | refresh cookie | Rotate the session, issue a new access token |
| `POST /api/v1/auth/logout`   | refresh cookie | Revoke the session                           |
| `GET /api/v1/auth/me`        | access token   | The signed-in user, read fresh               |

### Token strategy

The access token is a short-lived (15 minute) JWT returned **in the response body** for
the client to hold in memory. The refresh token is an opaque random value delivered
**only as an httpOnly cookie**, so no long-lived credential is ever reachable from
JavaScript and nothing is put in `localStorage`.

The cookie is `HttpOnly`, `SameSite=Lax` in development and `SameSite=None; Secure` in
production, and is scoped to `Path=/api/v1/auth` so it is not attached to ordinary API
calls.

Refresh tokens are **rotated on every use** and only their SHA-256 digest is stored. A
fast digest is the right choice here rather than Argon2: the token is already 384 bits of
uniform randomness, so key stretching protects against nothing, and a salted hash could
not be looked up by value.

**Reuse detection.** A refresh token works exactly once. Presenting one that has already
been rotated means the value leaked, so every session for that user is revoked - locking
out the attacker and forcing the legitimate holder to sign in again.

### Authorisation

Authentication is **on by default**: a global guard protects every route, and exposing an
endpoint requires an explicit `@Public()`. Forgetting a guard therefore fails closed.
`@Roles(...)` restricts a route further; a route without it is open to any authenticated
caller.

Roles are `ADMIN`, `MANAGER`, `STAFF` and `TECHNICIAN`. The access token carries the role,
so authorisation costs no database round trip; the trade-off is that a role change takes
effect on the next token refresh, within the 15-minute access-token lifetime. Deactivating
a user is immediate: it revokes their refresh tokens, and `GET /auth/me` re-reads status.

### Registration policy

`POST /auth/register` is public. Every self-registration **founds a brand-new
organization** and the registrant becomes its `ADMIN` - there is no shared "first user of
the database" bootstrap and no open self-registration into an existing org. Teammates are
added by an admin through `POST /api/v1/users`, which joins the caller's own organization;
elevated roles are granted the same way.

### Other protections

- Argon2id password hashing with OWASP parameters (19 MiB, 2 iterations, 1 lane).
- A wrong password and an unknown email return the identical error, and a candidate
  password is hashed even when the account does not exist so the two paths cost the same
  and cannot be told apart by timing.
- Login is limited to 5 attempts per minute, registration to 10, refresh to 30 - well
  below the global allowance.
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are validated at startup: both required,
  minimum 32 characters, and they must differ.
- Password hashes are excluded by explicit `select`, so a future model change cannot leak
  one into a response.

### Multi-tenancy

Every tenant-scoped table carries an `organizationId`, enforced by a Prisma client
extension that injects the current organization into every query - not by 182 manual
`where` clauses. The current organization comes from the caller's JWT, populated into an
`AsyncLocalStorage` context by `JwtAuthGuard` before any query runs; there is no code path
that queries a tenant table outside that context. A resource belonging to another
organization is invisible, not forbidden: a cross-tenant `GET`/`PATCH`/`DELETE` by id
returns `404`, matching how the injected filter makes the row simply not exist from the
requester's point of view.

### Billing

New organizations start `trialing` for 14 days. `POST /api/v1/billing/checkout-session`
and `POST /api/v1/billing/portal-session` (both `ADMIN`-only) redirect to Stripe-hosted
pages; `POST /api/v1/billing/webhook` is the Stripe-signature-verified endpoint that keeps
`subscriptionStatus` in sync (`checkout.session.completed`, `customer.subscription.updated`
/`.deleted`, `invoice.payment_failed`). Once an organization's trial has lapsed and it
isn't `active`, every route except billing and auth answers `402` with an error code the
frontend redirects on. Stripe is optional at the infrastructure level: with no
`STRIPE_SECRET_KEY` configured the API still boots, just refuses to process billing
requests. See `.env.example` for the three `STRIPE_*` variables and how to register a
webhook locally with the Stripe CLI.

### Users

`GET /api/v1/users` supports pagination, search across name and email, filters on role and
status, and sorting restricted to a **whitelist** of columns - an open column name would
let a caller order by `passwordHash`.

There is deliberately no `DELETE /users/:id`. Users are referenced by stock movements,
orders and every other ledger under `ON DELETE RESTRICT` so history stays attributable;
`PATCH /users/:id/status` is how access is removed. An administrator cannot change their
own role or status, and the last active administrator cannot be demoted or deactivated.

---

## Customers

| Endpoint                             | Roles                  |
| ------------------------------------ | ---------------------- |
| `GET /api/v1/customers`              | any authenticated user |
| `GET /api/v1/customers/:id`          | any authenticated user |
| `POST /api/v1/customers`             | ADMIN, MANAGER, STAFF  |
| `PATCH /api/v1/customers/:id`        | ADMIN, MANAGER, STAFF  |
| `DELETE /api/v1/customers/:id`       | ADMIN, MANAGER         |
| `POST /api/v1/customers/:id/restore` | ADMIN, MANAGER         |

Reads are open to every role because a technician working a repair needs the customer's
contact details; writing is limited to the roles that serve customers, and removal to the
roles that answer for it.

**Codes are supplied by the business**, not generated, in the same way a SKU or a supplier
code is - `customerCode` must look like `CUS-0001` and is uppercased on the way in so
`cus-1` and `CUS-1` cannot become two customers. Document numbers for _transactions_
(orders, repairs, returns) are a different matter and are generated server-side from
Phase 8.

**Delete is soft.** Customers are referenced by orders, repairs and returns under
`ON DELETE RESTRICT`, so removing the row would either fail or destroy the history that
points at it. `DELETE` stamps `deletedAt`, which hides the customer from reads and lists;
`includeDeleted=true` reveals them and `POST /:id/restore` brings one back. Because the
unique index still covers deleted rows, reusing a deleted customer's code returns a
conflict that says so, rather than a bare 409.

### Query parameters

Shared by every list endpoint: `page`, `limit` (max 100), `sortOrder`, `search`. Customers
add `sortBy` (whitelisted to `createdAt`, `updatedAt`, `customerCode`, `firstName`,
`lastName`, `phone`, `email`), `includeDeleted`, `createdFrom` and `createdTo`.

`search` splits on whitespace and requires **every** term to match somewhere across code,
first name, last name, phone and email - so `Leila Farouk` finds a person whose name spans
two columns, while a single term still matches a code or a phone number.

---

## Suppliers

| Endpoint                             | Roles                  |
| ------------------------------------ | ---------------------- |
| `GET /api/v1/suppliers`              | any authenticated user |
| `GET /api/v1/suppliers/:id`          | any authenticated user |
| `POST /api/v1/suppliers`             | ADMIN, MANAGER         |
| `PATCH /api/v1/suppliers/:id`        | ADMIN, MANAGER         |
| `DELETE /api/v1/suppliers/:id`       | ADMIN, MANAGER         |
| `POST /api/v1/suppliers/:id/restore` | ADMIN, MANAGER         |

Suppliers work like customers - business-chosen `SUP-0001` codes, soft delete with restore,
multi-term search, `includeDeleted`, date-range filtering and whitelisted sorting (`createdAt`,
`updatedAt`, `supplierCode`, `name`, `contactPerson`, `phone`, `email`), searching across
code, name, contact person, phone and email.

**Writing is narrower than for customers.** Staff can read a supplier, because receiving a
delivery needs the contact details, but only ADMIN and MANAGER can create or change one:
a customer arrives at the counter and is entered by whoever serves them, whereas a supplier
is purchasing master data.

Soft delete matters here for a different reason than customers: a supplier is the
provenance of stock already on the shelves, so the record has to stay readable even once
the business stops buying from them.

---

## Product catalogue

| Endpoint                                           | Roles                  |
| -------------------------------------------------- | ---------------------- |
| `GET /api/v1/categories`, `/brands`, `/products`   | any authenticated user |
| `GET /api/v1/products/barcode/:barcode`            | any authenticated user |
| `POST`, `PATCH`, `DELETE`, `/restore` on all three | ADMIN, MANAGER         |

Everyone may read the catalogue - selling and repairing both need it. Only ADMIN and
MANAGER may change it, because a product record carries the cost and selling price.

### Money

Monetary values are **exact decimal strings end to end**. A price is validated as a string
matching at most two decimal places, passed as a string to Prisma, stored as
`Decimal(14, 2)`, and returned as a fixed two-decimal string:

```json
{ "sku": "ACC-GLS-UNIV", "costPrice": "1.05", "sellingPrice": "7.50" }
```

A JSON number is accepted on input for convenience and converted immediately, but no
monetary value is ever produced by floating-point arithmetic. Prisma's `Decimal` already
serialises to a string; `serialiseDecimalsAsFixedStrings()` pins the scale so `429.00`
does not reach a client as `"429"` while `1.05` arrives as `"1.05"`.

### Slugs

Categories and brands have a slug derived from the name when one is not supplied
(`Spare Parts` → `spare-parts`, `Café` → `cafe`). A supplied slug is lower-cased and
validated. **Renaming does not re-derive the slug** - it is a URL identifier, and silently
changing it would break every link already pointing at the category. Pass `slug` explicitly
to change it. A name that yields no slug at all is a 400 asking for one, rather than a
silently stored empty unique key.

### Catalogue integrity

- **Creating a product creates its inventory row** in the same transaction, at quantity
  zero and with no stock movement - nothing has moved, and the ledger records movements,
  not the act of listing a product. Every product therefore has an inventory row from the
  moment it exists.
- **A category or brand cannot be deleted while live products use it.** The response says
  how many. `Product.categoryId` is `ON DELETE RESTRICT` and required, so hiding a
  referenced category would leave live products pointing at something no list returns.
- **A product cannot be deleted while it holds stock.** Those units are physically on a
  shelf; hiding the product would strand them and stop the ledger reconciling.
- Category, brand and stock level are loaded **with** a page of products rather than per
  row, so a page costs a fixed number of queries however long it is.

### Query parameters

Products add `sortBy` (`createdAt`, `updatedAt`, `sku`, `name`, `costPrice`,
`sellingPrice`, `minimumStock`), `categoryId`, `brandId`, `isActive`, `includeDeleted`,
`minPrice`, `maxPrice`, `createdFrom` and `createdTo`, searching across SKU, barcode, name
and description. Categories and brands default to `name` ascending, which is what a picker
needs.

---

## Stock

| Endpoint                       | Roles                  |
| ------------------------------ | ---------------------- |
| `GET /api/v1/stock`            | any authenticated user |
| `GET /api/v1/stock/:productId` | any authenticated user |
| `GET /api/v1/stock/summary`    | any authenticated user |
| `GET /api/v1/stock/movements`  | any authenticated user |
| `POST /api/v1/stock/adjust`    | ADMIN, MANAGER         |

Everyone may read stock levels - selling, repairing and reordering all need them. Manual
movements are ADMIN/MANAGER only: an adjustment is the one place stock can be created or
destroyed **without a source document**, which makes it the control point. Staff move stock
through orders, repairs and returns, each of which has a document behind it.

### Stock can never move silently

The quantity change and its ledger entry are written in **one transaction**. Stock cannot
move without a `StockMovement` explaining it, and a movement cannot survive a change that
rolled back. Every movement records `previousQuantity` and `newQuantity`, so the ledger
chains: the current level is always reconstructable from history, and the tests assert that
reconciliation after concurrent traffic.

Only `PURCHASE`, `ADJUSTMENT_IN` and `ADJUSTMENT_OUT` can be posted by hand. `SALE`,
`RETURN_IN`, `RETURN_OUT`, `REPAIR_IN` and `REPAIR_OUT` are produced by their own
workflows against real documents - accepting them here would let the ledger claim a sale
that never happened.

### Concurrency

The change is a **single conditional UPDATE**, never a read in JavaScript followed by a
write:

```sql
UPDATE "Inventory"
SET "quantity" = "quantity" + $delta, "updatedAt" = NOW()
WHERE "productId" = $id AND "quantity" + $delta >= "reservedQuantity"
```

Two people selling the last unit would both pass a JavaScript check and both write. Here the
second statement blocks on the row lock, then re-evaluates its `WHERE` against the value the
first one committed, and matches no rows - so it is rejected with a 409 naming what is
actually available. The one guard covers both rules at once: stock cannot go negative, and
it cannot drop below what is already reserved for an order.

The database is the arbiter, with the `Inventory_quantity_non_negative` and
`Inventory_reserved_within_quantity` check constraints as the backstop behind it.
`test/stock-concurrency.e2e-spec.ts` fires genuinely simultaneous requests at the real
database and asserts that exactly as many succeed as there was stock, that the level never
goes negative, that there is exactly one movement per success and none for a rejection, and
that the ledger still reconciles.

### Low and out of stock

`stockStatus` filters the listing to `OUT` (empty), `LOW` (at or below the product's own
minimum, but not empty), `OK`, or `ALL`. The two are separate because they call for
different action: one is a reorder, the other is a lost sale.

That filter compares `Inventory.quantity` against `Product.minimumStock` - two columns in
two tables - which no ORM filter API can express, so the stock listing is written as
parameterised SQL. Filtering in JavaScript instead would mean fetching every product to
answer one page and would make `meta.total` a lie. Values are always bound parameters; the
`ORDER BY` fragment comes from a fixed lookup table keyed by an already-validated field
name, and a search term containing SQL is matched literally (there is a test for that).

`GET /stock/summary` returns product and unit counts, low and out-of-stock counts, and the
inventory valued at cost and at retail - all computed in the database, so the valuation is
exact `numeric` arithmetic rather than summed floats.

---

## Orders

| Endpoint                                  | Roles                  |
| ----------------------------------------- | ---------------------- |
| `GET /api/v1/orders`                      | any authenticated user |
| `GET /api/v1/orders/:id`                  | any authenticated user |
| `GET /api/v1/orders/:id/payments`         | any authenticated user |
| `POST /api/v1/orders`                     | ADMIN, MANAGER, STAFF  |
| `PATCH /api/v1/orders/:id`                | ADMIN, MANAGER, STAFF  |
| `POST /api/v1/orders/:id/items`           | ADMIN, MANAGER, STAFF  |
| `PATCH /api/v1/orders/:id/items/:itemId`  | ADMIN, MANAGER, STAFF  |
| `DELETE /api/v1/orders/:id/items/:itemId` | ADMIN, MANAGER, STAFF  |
| `POST /api/v1/orders/:id/confirm`         | ADMIN, MANAGER, STAFF  |
| `POST /api/v1/orders/:id/complete`        | ADMIN, MANAGER, STAFF  |
| `POST /api/v1/orders/:id/cancel`          | ADMIN, MANAGER, STAFF  |
| `POST /api/v1/orders/:id/payments`        | ADMIN, MANAGER, STAFF  |

Anyone signed in may read orders - a technician checking what a customer bought needs them.
Technicians cannot sell; their work goes through repairs.

### The lifecycle

```text
  DRAFT ---confirm--> CONFIRMED ---complete--> COMPLETED
    |                     |
    +------cancel---------+-------> CANCELLED
```

A **draft** is a basket: lines come and go, nothing is promised, and no stock is touched.
**Confirming** reserves the stock, which is the moment those units stop being available to
anyone else, and freezes the lines - an agreed price cannot move afterwards. **Completing**
hands the goods over: the quantity leaves the shelf and a `SALE` movement records why. A
completed order is final - goods come back through a return, never by editing history.

There is no direct `DRAFT -> COMPLETED` shortcut. Reservation is the whole point of the
confirmed state, and skipping it would mean a sale that never held the stock it sold.

### Reservation, not deduction

Confirming raises `Inventory.reservedQuantity`; it does **not** lower `quantity`. The units
are still on the shelf, merely promised. That is why confirmation writes no `StockMovement`:
the ledger records changes to what is actually on hand, and nothing has moved yet.

Completion lowers `quantity` and `reservedQuantity` together, in one statement, which is
what keeps the `Inventory_reserved_within_quantity` constraint satisfied at every instant.
Cancelling a confirmed order gives the reservation back and, again, writes no movement -
nothing ever left.

A manual `ADJUSTMENT_OUT` cannot take units an order has reserved: the stock guard is
`quantity + delta >= reservedQuantity`, so reserved stock is protected from every other
caller, not just from other orders.

### Concurrency

Every state change is a **conditional UPDATE**, never a read in JavaScript followed by a
write:

```sql
-- the transition, which also takes the order's row lock
UPDATE "Order" SET "status" = 'CONFIRMED' WHERE "id" = $1 AND "status" = 'DRAFT';

-- the reservation
UPDATE "Inventory" SET "reservedQuantity" = "reservedQuantity" + $1
WHERE "productId" = $2 AND "quantity" - "reservedQuantity" >= $1;

-- the payment
UPDATE "Order" SET "paidAmount" = "paidAmount" + $1
WHERE "id" = $2 AND "paidAmount" + $1 <= "total";
```

Two simultaneous confirmations of the same order cannot both succeed: the second blocks on
the row lock, re-evaluates its `WHERE` against the committed value, and matches nothing.
Draft edits take that same lock first, so a line cannot slip in beside a confirmation that
is already under way. Two cashiers taking payment at once cannot together collect more than
the total.

Inventory rows are always locked **in product order**, sorted by `productId`, so two orders
holding the same two products cannot take the two locks in opposite directions and deadlock.
The comparison is plain code-unit ordering rather than `localeCompare`, which follows the
runtime's locale and could disagree between servers.

The concurrency suite proves each of these against the real database rather than asserting
them: 30 orders against 20 units confirm exactly 20 times, a double completion ships once
and writes one movement, and 10 simultaneous payments against a 50.00 order accept exactly
five of ten.

### Money

Every amount is a `Prisma.Decimal` from the request body to the column - exact base-ten
arithmetic, never a binary float. The rules live in `order-totals.ts` as pure functions with
no database client, so what a receipt depends on can be tested directly:

```text
line total  = unitPrice x quantity - line discount
subtotal    = sum of line totals
order total = subtotal - order discount + tax
outstanding = total - paidAmount
```

`unitPrice` defaults to the product's current selling price and is **copied onto the line**,
so a later catalogue change cannot rewrite what a customer was charged. An override is
allowed because shops negotiate.

Totals are always recomputed from the lines actually in the database, so a total can never
drift from what it is the sum of. A discount larger than the thing it discounts is rejected
(422) - including when removing a line would strand an order-level discount above the new
subtotal, which says so rather than silently reducing it.

`tax` is an amount rather than a rate: nothing in the orders workflow reads a configurable
rate from [Settings](#settings) today, and inventing that wiring here would be scope this
module was never asked to own.

Payments are only accepted against a `CONFIRMED` or `COMPLETED` order - nothing has been
agreed on a draft - and overpayment is refused. `paymentStatus` is derived from the amounts;
`REFUNDED` is never inferred here, because money only travels back out through a return.
An order with a payment recorded against it cannot be cancelled: it needs a refund, which is
the returns and finance workflow's job.

### Document numbers

`orderNumber` and `paymentNumber` are drawn from PostgreSQL sequences (`ORD-00000042`).
They are printed on receipts, so they cannot be uuids, and they cannot come from
`MAX(number) + 1` - two tills ringing up a sale in the same instant would read the same
maximum and choose the same number.

Sequences are non-transactional by design, so a rolled-back sale consumes its number and
leaves a gap. That is the accepted trade-off: a gapless counter would serialise every sale
behind a single row lock. The numbers stay unique and monotonic either way.

The seed writes fixed numbers so it can be re-run without duplicating orders, then advances
both sequences past them, so the first real sale on a freshly seeded database is
`ORD-00000007` rather than a number already on a seeded receipt.

### Query parameters

`status`, `paymentStatus`, `customerId`, `createdById`, `createdFrom` / `createdTo`,
`completedFrom` / `completedTo`, and `search` across `orderNumber` and `notes`. Customers
are found by `customerId` rather than by name here: reaching across the relation would turn
every order search into a join over the whole customer table.

`completedAt` is filtered separately from `createdAt` because revenue keys off when a sale
actually closed - a draft raised last month must not distort today's figures.

Sorting is restricted to `createdAt`, `completedAt`, `orderNumber`, `total` and `status`.

---

## Repairs

| Endpoint                                   | Roles                      |
| ------------------------------------------ | -------------------------- |
| `GET /api/v1/repairs`                      | any authenticated user     |
| `GET /api/v1/repairs/:id`                  | any authenticated user     |
| `GET /api/v1/repairs/:id/history`          | any authenticated user     |
| `GET /api/v1/repairs/:id/payments`         | any authenticated user     |
| `POST /api/v1/repairs/:id/status`          | any authenticated user     |
| `POST /api/v1/repairs`                     | ADMIN, MANAGER, STAFF      |
| `POST /api/v1/repairs/:id/payments`        | ADMIN, MANAGER, STAFF      |
| `PATCH /api/v1/repairs/:id`                | ADMIN, MANAGER, TECHNICIAN |
| `POST /api/v1/repairs/:id/items`           | ADMIN, MANAGER, TECHNICIAN |
| `PATCH /api/v1/repairs/:id/items/:itemId`  | ADMIN, MANAGER, TECHNICIAN |
| `DELETE /api/v1/repairs/:id/items/:itemId` | ADMIN, MANAGER, TECHNICIAN |

Reading is open to everyone: the counter needs to answer "is it ready yet?" as much as the
bench does. Intake and payment belong to the front desk; diagnosis, costs and parts to the
people qualified to fit them. Moving a repair along is open to any signed-in user, because
the counter hands devices back and the bench does the work - and every move is recorded
with the name of whoever made it.

### The workflow

```text
  RECEIVED -> DIAGNOSING -> WAITING_APPROVAL -> APPROVED -> IN_PROGRESS -> COMPLETED -> DELIVERED
                   |                                |          |    ^
                   +-- straight to APPROVED when    |          v    |
                       the fault is obvious         +----> WAITING_PARTS

  every unfinished status -> CANCELLED
```

The workflow is a **map of what may follow what**, not a chain of `if`s, so it can be read
in one place and an illegal move is refused by the same rule wherever it is attempted. Two
statuses are terminal: a `DELIVERED` repair has gone home and a `CANCELLED` one is
abandoned. Neither may move again, because the alternative is a device that has left the
shop being quietly put back into progress.

`COMPLETED` is closed to further changes even though it can still be delivered: its parts
have already left stock, so editing them afterwards would put the ledger and the device out
of step.

### Status history is the repair's audit trail

Every move writes a `RepairStatusHistory` row carrying **from, to, when, who and why** - in
the same transaction as the status change, so a refused move leaves no trace of a change it
never made. Intake writes the first row with `fromStatus` null: the device came from outside
the workflow, so there is no status it moved out of.

### Parts

A part behaves the way a line on an order does:

| Action              | Stock effect                                 | Ledger       |
| ------------------- | -------------------------------------------- | ------------ |
| Fitting a part      | reserves it                                  | nothing yet  |
| Changing a quantity | reserves or releases **only the difference** | nothing yet  |
| Taking a part off   | releases it                                  | nothing      |
| Completing the job  | quantity and reservation fall together       | `REPAIR_OUT` |
| Cancelling the job  | releases it                                  | nothing      |

The units stay on the shelf until the repair is finished, which is the only point at which
anyone can say for certain that they were used - but they are reserved from the moment they
are promised to a device, so a part on the bench cannot be sold from under it. A manual
`ADJUSTMENT_OUT` cannot take them either, and neither can an order: sales and repairs
compete for the same units through the same guard, and there is a test for exactly that.

The stock operations themselves are shared with orders rather than reimplemented - see
[Concurrency](#concurrency-1).

### Money

`finalCost` is what the shop charges and **a repair cannot be completed until it is set**
(422 if it is not). It is never inferred from the parts: a repair is priced on labour,
diagnosis and goodwill as much as on components. `partsTotal` is reported alongside it for
information, computed as an exact decimal.

A repair has no `paidAmount` column, so what has been collected is the sum of its payments,
and `outstanding` is `finalCost - paidAmount`. Until the repair is priced, `outstanding` is
**null** rather than zero: what is owed is not yet known, and saying "nothing" would be a
different claim.

Payments are only accepted once a repair is `COMPLETED` or `DELIVERED`, and overpayment is
refused. Because there is no counter column to increment atomically, the guard takes the
repair's row lock with `SELECT ... FOR UPDATE` before adding the payments up; every writer
passes through that lock, so no payment can land between the total being read and the new
row being written. Ten simultaneous payments against a 50.00 job accept exactly five.

### Concurrency

Every state change is a conditional `UPDATE` on the repair row:

```sql
UPDATE "Repair" SET "status" = 'COMPLETED', "completedAt" = NOW()
WHERE "id" = $1 AND "status" = 'IN_PROGRESS';
```

The transition is checked against the map first, then applied conditionally, so a status
read a moment ago cannot be acted on after somebody else has moved it - the second request
gets a conflict telling it to reload. Part edits take the same lock and assert the repair is
still open, so a part cannot be fitted beside a completion already under way.

Inventory rows are locked in product order, so two repairs holding the same two parts cannot
deadlock. Ten repairs fitted with the same pair of parts in opposite orders and completed
simultaneously all succeed.

### Assignment

A repair can only be assigned to an **active** user whose role is `TECHNICIAN`, `ADMIN` or
`MANAGER`. Handing work to a deactivated account, or to a salesperson, leaves a job nobody
is actually looking at.

### Query parameters

`status`, `deviceType`, `customerId`, `technicianId`, `receivedFrom` / `receivedTo`,
`completedFrom` / `completedTo`, plus three shortcuts for the questions a shop actually
asks:

- **`openOnly`** - work still on the bench, without listing six statuses.
- **`overdue`** - promised date gone by and not finished.
- **`unassigned`** - nobody has picked it up.

Where a shortcut and an explicit filter overlap, the explicit one wins: `technicianId` beats
`unassigned`, and `status` beats `openOnly`.

Search covers `repairNumber`, `serialNumber`, `imei`, `brand`, `model` and
`problemDescription` - serial and IMEI because a customer who has lost their ticket is
identified by the device in their hand. Both are upper-cased on the way in so a device is
found however it was typed.

Sorting is restricted to `receivedAt`, `completedAt`, `expectedCompletionAt`,
`repairNumber`, `status` and `createdAt`.

---

## Returns

| Endpoint                                   | Roles                  |
| ------------------------------------------ | ---------------------- |
| `GET /api/v1/returns`                      | any authenticated user |
| `GET /api/v1/returns/:id`                  | any authenticated user |
| `GET /api/v1/returns/:id/payments`         | any authenticated user |
| `POST /api/v1/returns`                     | ADMIN, MANAGER, STAFF  |
| `PATCH /api/v1/returns/:id`                | ADMIN, MANAGER, STAFF  |
| `POST /api/v1/returns/:id/items`           | ADMIN, MANAGER, STAFF  |
| `PATCH /api/v1/returns/:id/items/:itemId`  | ADMIN, MANAGER, STAFF  |
| `DELETE /api/v1/returns/:id/items/:itemId` | ADMIN, MANAGER, STAFF  |
| `POST /api/v1/returns/:id/approve`         | ADMIN, MANAGER         |
| `POST /api/v1/returns/:id/reject`          | ADMIN, MANAGER         |
| `POST /api/v1/returns/:id/complete`        | ADMIN, MANAGER         |

Raising a return is counter work, so staff can do it. Deciding whether the shop takes the
goods back, and handing money over, is not: approval, rejection and completion are limited
to ADMIN and MANAGER, because that is the point at which stock and cash actually move.

### The workflow

```text
  PENDING --approve--> APPROVED --complete--> COMPLETED
     |
     +---reject--> REJECTED
```

A return is raised against a **completed** order (422 otherwise - a draft or a cancelled
order never delivered goods to take back). Approval is a separate step from completion on
purpose: it is the point at which the shop commits to the return, and separating it lets the
two decisions sit with different people. Nothing moves on approval - no stock, no money.
Only on completion do goods come back and the refund go out, in one transaction, so a refund
can never exist for goods that were not restored, or the reverse.

`REJECTED` and `COMPLETED` are both final. A rejected return releases its claim on the
goods, so the same units are open to be claimed by another return; a completed one has
already moved stock and money and cannot be replayed.

### What a line has left to return

Every return line is priced against **what the order line was actually charged**, net of
its own discount - not the catalogue price. A return can only take back what an order line
has left: the sum of every return already raised against that line (pending, approved or
completed) is checked before a new claim is accepted, and a rejected return does not count,
since the shop never took those goods back.

Every claim on an order line is checked with the **order's row locked**, so two returns
raised against the same line at the same instant cannot both succeed for more than the line
actually sold - twenty attempts at two units each against six units sold produces exactly
three successes and seventeen refusals, and there is a test for exactly that.

### Refund rounding

A line of three units charged 50.00 cannot be split into three equal refunds - a third is
16.666..., which has no exact two-decimal form. Refunding a third three times over would
either short the customer a cent or overpay the shop's till by one.

The rule: **taking back the last of a line refunds exactly what is left of it**. Earlier
partial returns are proportional and rounded; the final one sweeps up the remainder. However
a line is broken up - one return, or five - the refunds always sum to precisely what was
charged. This lives as pure, dependency-free functions in `return-refunds.ts`, tested
directly against the rounding boundary rather than only through the API.

### Money: only what was actually collected

`refundAmount` is the **credit** - what the returned goods were charged. `paidBackAmount` is
what actually went back, which can be smaller: an order that was only half paid can only be
refunded half, because the rest of the credit stands against goods nobody had paid for in
the first place. `outstandingCredit` is the difference, and it is reported rather than
hidden - the shop can see it as a store credit or a write-off, whichever it decides.

Refunds already paid against the same order are counted before a new one is calculated, so
two returns on the same order cannot together hand back more than was collected. Once
everything collected has gone back, the order's `paymentStatus` becomes `REFUNDED`; a
part-refunded order is left alone.

A refund of exactly zero is a real, valid outcome - goods returned against an order that was
never paid for - and the database rejects a payment of nothing, so on that path no `Payment`
row is written at all. The goods still come back onto the shelf regardless: restocking and
refunding are two separate questions.

### Restocking

`restock` on each line decides whether the goods go back on the shelf. False for anything
that comes back broken: the customer is still credited in full, but the units are written
off rather than put back into sellable stock, so the ledger never claims stock the shop
cannot actually sell. Only sellable lines produce a `RETURN_IN` movement.

Restoring stock reuses the shared inventory module from orders and repairs
(`common/inventory/stock-operations.ts`) rather than a fourth copy of the same logic. Unlike
reserving or consuming, restoring can never be refused - stock going up cannot breach the
non-negative or reserved-within-quantity constraints - so it is a plain conditional update
with nothing to reject.

### Concurrency

Every transition is a conditional `UPDATE` on the return row, the same pattern as orders and
repairs. Completing a return twice at the same moment restores stock once, writes one
refund, and the loser gets a conflict rather than a second payment. An approval and a
rejection raised at the same instant settle on exactly one outcome.

### Query parameters

`status`, `reason`, `orderId`, `customerId`, `createdById`, `createdFrom` / `createdTo`,
`completedFrom` / `completedTo`, and search across `returnNumber` and `reasonNote`.

Sorting is restricted to `createdAt`, `completedAt`, `returnNumber`, `refundAmount` and
`status`.

---

## Finance

| Endpoint                               | Roles                  |
| -------------------------------------- | ---------------------- |
| `GET /api/v1/finance/expenses`         | any authenticated user |
| `GET /api/v1/finance/expenses/:id`     | any authenticated user |
| `POST /api/v1/finance/expenses`        | ADMIN, MANAGER         |
| `PATCH /api/v1/finance/expenses/:id`   | ADMIN, MANAGER         |
| `DELETE /api/v1/finance/expenses/:id`  | ADMIN, MANAGER         |
| `GET /api/v1/finance/payments`         | any authenticated user |
| `GET /api/v1/finance/payments/:id`     | any authenticated user |
| `GET /api/v1/finance/transactions`     | any authenticated user |
| `GET /api/v1/finance/transactions/:id` | any authenticated user |
| `POST /api/v1/finance/transactions`    | ADMIN, MANAGER         |
| `GET /api/v1/finance/summary`          | any authenticated user |

Expenses are a back-office record, so recording, correcting and removing one sits at the
same bar as approving a return or taking a repair payment. Reading is open to any
authenticated user, like every other module.

### One ledger, fed by every module that moves money

`FinancialTransaction` is a single table that every source of income or outflow writes
into: an order payment writes a `SALE` entry, a repair payment writes `REPAIR_PAYMENT`, a
return refund writes `REFUND`, and recording an expense writes `EXPENSE` - all in the same
transaction as the write that earns them, so the ledger and the record it describes can
never disagree. The one entry a caller may write directly is `OTHER_INCOME`: money that
arrived outside a sale, a repair or a return, with nowhere else to be recorded. Every other
type is system-derived and cannot be posted through the API - forging a `SALE` entry with
no order behind it would let the ledger claim money nothing backs.

Financial summaries read this ledger rather than re-deriving totals by joining every source
table on every request, which is what it exists for. Only the expense-by-category breakdown
comes from `Expense` directly, since category is not something the ledger carries.

### Expenses keep their ledger entry in step

Recording an expense writes its `EXPENSE` ledger entry in the same transaction. Correcting
an expense's amount, description or date updates the ledger entry to match, rather than
leaving a stale copy behind; removing an expense removes both rows together. A category
change alone leaves the ledger's amount, description and date exactly as they were, since
none of those changed.

### Money actually collected, not money nominally owed

The summary's income figures are amounts that were actually paid, not order totals or
invoiced amounts: an order confirmed but never paid contributes nothing until a payment is
recorded against it. Refunds are read separately from income, so a return does not quietly
shrink a sale figure it should instead be weighed against - `netRevenue` is income net of
refunds, and `netPosition` is that figure net of expenses.

### Query parameters

Expenses: `category`, `createdById`, `expenseFrom` / `expenseTo`, and search across
`expenseNumber` and `description`. Sorting is restricted to `expenseDate`, `amount`,
`category` and `createdAt`.

Payments: `method`, `referenceType`, `createdById`, `paidFrom` / `paidTo`, and search across
`paymentNumber` and `reference`. Sorting is restricted to `paidAt`, `amount` and `method`.

Transactions: `type`, `referenceType`, `createdById`, `occurredFrom` / `occurredTo`, and
search across `description`. Sorting is restricted to `occurredAt`, `amount` and `type`.

Summary: an optional `from` / `to` window; omitted, it reports over all time.

---

## Dashboard

`GET /api/v1/dashboard` returns one KPI bundle, open to any authenticated user. Every figure
is either counted directly or reused from the module that owns it - `FinanceService.summary()`
for money, `StockService` for inventory - rather than re-derived, so the dashboard can never
disagree with the page a figure came from.

```text
sales             totalOrders, today, thisMonth, grossRevenue
finance           expenses, netPosition
inventory         the stock summary: totalProducts, totalUnits, valueAtCost, valueAtRetail,
                  lowStockCount, outOfStockCount
repairs           active, completed, statusDistribution (every RepairStatus, zero-filled)
returns           pending
customers         total
recentSales       the ten most recently completed orders
recentStockMovements   the ten most recent movements, reusing the stock module's own listing
salesChart        revenue for each of the last 14 days, zero-filled so the chart has no gaps
```

`totalOrders` is a count; `grossRevenue` is money - kept as two figures on purpose, since a
dashboard that only said "sales: 6" or only said "sales: $600.00" would be answering half the
question. `today` and `thisMonth` are scoped to `SALE` ledger entries specifically, not all
income, so a repair payment or a manual entry does not inflate what the till actually rang up.

Every underlying query is a single aggregate - counts, sums and one `GROUP BY` for the chart -
run in parallel with `Promise.all`, never a loop that fetches rows to fold in JavaScript.

## Reports

| Endpoint                           | Roles                  |
| ---------------------------------- | ---------------------- |
| `GET /api/v1/reports/sales`        | any authenticated user |
| `GET /api/v1/reports/inventory`    | any authenticated user |
| `GET /api/v1/reports/top-products` | any authenticated user |

Reports break a figure the dashboard already shows down further - by period, by category, by
product - rather than introducing new totals to keep in sync with it.

**`sales`** - revenue over an optional `from` / `to` window, grouped by `groupBy` (`day`,
`week` or `month`; default `day`). Each point carries its own order count, subtotal, discount,
tax and total; the response also carries the sum of every point as `totals`, so a caller never
has to fold the series itself. An empty window reports no points and zeroed totals rather than
a fabricated one.

**`inventory`** - the stock valuation broken down by category: product count, units, value at
cost and at retail, and low/out-of-stock counts, one row per category. `totals` is the same
catalogue-wide `StockSummary` the dashboard and `/api/v1/stock/summary` already return, not a
second computation of it.

**`top-products`** - the best-selling products by revenue over an optional `from` / `to`
window, each with units sold and revenue, capped at `limit` (default 10, maximum 50).

`sales` and `top-products` both key off `Order.completedAt`, the same column revenue reporting
uses everywhere else in this API - a draft raised last month and only completed today belongs
to today's figures, not last month's.

---

## Audit

| Endpoint                | Roles |
| ----------------------- | ----- |
| `GET /api/v1/audit`     | ADMIN |
| `GET /api/v1/audit/:id` | ADMIN |

The append-only trail every money- and security-relevant action writes into, in the same
transaction as the change it describes. `record()` takes an optional transaction client, so a
call inside an existing `$transaction` writes atomically with it: if the transaction rolls
back, no orphaned entry claims something happened that did not.

Tracked today: `LOGIN` / `LOGIN_FAILED` / `LOGOUT`, user creation / `ROLE_CHANGED` /
`STATUS_CHANGED`, product `CREATE` / `UPDATE` / `DELETE`, `STOCK_ADJUSTED`, `ORDER_COMPLETED`
/ `ORDER_CANCELLED`, `RETURN_APPROVED` / `RETURN_COMPLETED`, `REPAIR_STATUS_CHANGED`,
`PAYMENT_RECORDED` (orders, repairs and return refunds alike), and expense `CREATE` / `UPDATE`
/ `DELETE`. `userId` is `null` for an event with no authenticated actor, such as a failed
login against an unknown address, and stays `null` once an actor's account is later removed -
the row survives on `ON DELETE SET NULL`, because the trail is what a real audit log is for.

`metadata` carries business context only - amounts, statuses, what changed - never a
password, a JWT or a refresh token. Reading the trail is ADMIN-only, tighter than every other
read endpoint in this API, since it is the one place that can show who did what, from where,
across the whole system.

### Query parameters

`userId`, `action`, `entity`, `entityId`, `createdFrom` / `createdTo`. Sorting is restricted
to `createdAt`.

## Settings

| Endpoint                       | Roles          |
| ------------------------------ | -------------- |
| `GET /api/v1/settings`         | ADMIN, MANAGER |
| `GET /api/v1/settings/:key`    | ADMIN, MANAGER |
| `PUT /api/v1/settings/:key`    | ADMIN          |
| `DELETE /api/v1/settings/:key` | ADMIN          |

System configuration, keyed by name rather than id: a caller wants "the setting called
`low_stock_alert_threshold`", not a uuid it has to look up first. `PUT` creates the setting if
the key is new and replaces it if not, so there is one write verb for both rather than a
create/update split a config store has no use for.

`value` is always stored as text; `valueType` (`STRING` / `NUMBER` / `BOOLEAN` / `JSON`) says
how to decode it. A write is rejected if `value` does not parse as its declared type - a
`NUMBER` that is not a number, a `BOOLEAN` that is not `true` or `false`, `JSON` that does not
parse. Every read carries `parsedValue`, decoded from `value` at read time rather than kept as
a second stored column that could drift from the text it was parsed from.

Writing a setting is ADMIN-only, the same bar as changing a user's role: a setting can change
how the whole deployment behaves. Every create, replace and removal writes an audit entry.

---

## Build status

Delivered so far:

- **Phase 0 — Repository bootstrap.** pnpm workspace, folder structure, shared TypeScript
  presets (`@stock-pro/tsconfig`), shared ESLint presets (`@stock-pro/eslint-config`),
  Prettier, `.gitignore`, `.env.example`, this README.
- **Phase 1 — API bootstrap.** NestJS application on `/api/v1` with startup environment
  validation, typed configuration, the response envelope, centralised error handling,
  request correlation ids, the global validation pipe, helmet security headers, CORS,
  rate limiting, Swagger, and liveness/readiness probes. Unit and end-to-end tests
  included.
- **Phase 2 — Database.** Dockerised PostgreSQL 17, the complete Prisma schema (22 tables,
  17 enums) with its initial migration and check constraints, the global `PrismaModule`,
  Argon2id password hashing, a re-runnable development seed, and a database readiness
  indicator on `/api/v1/health`. Covered by an integration suite that asserts the
  invariants against the real server.
- **Phase 3 — Authentication and users.** Registration, login, rotating refresh tokens with
  reuse detection, logout, `GET /auth/me`, global authentication and role guards,
  `@Public()` / `@Roles()` / `@CurrentUser()`, credential rate limiting, and the
  `/api/v1/users` administration API with pagination, search, filters and whitelisted
  sorting. See [Authentication](#authentication).
- **Phase 4 — Customers.** Full CRUD with role-scoped access, soft delete and restore,
  multi-term search, date-range filtering and whitelisted sorting. See
  [Customers](#customers).
- **Phase 5 — Suppliers.** The same surface with narrower write permissions, plus the
  shared search, code-format and normalisation helpers both modules now use. See
  [Suppliers](#suppliers).
- **Phase 6 — Product catalogue.** Categories, brands and products with slug derivation,
  exact decimal money, barcode lookup, price-range and relation filters, and the
  integrity rules that keep the catalogue and the stock ledger consistent. See
  [Product catalogue](#product-catalogue).
- **Phase 7 — Stock.** Inventory levels, the movement ledger, transactional adjustments
  with a conditional UPDATE that survives concurrent withdrawals, low/out-of-stock
  filtering in SQL, and database-computed valuation. See [Stock](#stock).
- **Phase 8 — Orders.** The draft/confirmed/completed/cancelled lifecycle, order lines and
  exact-decimal totals, stock reservation on confirmation and deduction on completion,
  order payments with overpayment refused, and sequence-backed document numbers. Every
  transition and every money movement is a conditional UPDATE, proven against the real
  database by a dedicated concurrency suite. See [Orders](#orders).

- **Phase 9 — Repairs.** The nine-status workflow as a transition map, status history as
  the repair's own audit trail, parts that reserve stock when fitted and consume it on
  completion, repair payments guarded by a row lock, and a workbench listing with
  open/overdue/unassigned filters. The reservation machinery is now shared with orders
  rather than duplicated. See [Repairs](#repairs).
- **Phase 10 — Returns.** The pending/approved/rejected/completed workflow, refunds priced
  against what an order line actually charged with exact rounding across partial returns,
  restocking that is separate from refunding, refunds capped at what was actually collected,
  and inventory restoration reusing the shared stock-operations module for a third time
  rather than a third copy. See [Returns](#returns).
- **Phase 11 — Finance.** Expenses with a document number and a ledger entry kept in step
  across correction and removal, a `FinancialTransaction` ledger fed by every module that
  moves money (order payments, repair payments, return refunds, expenses, and manually
  recorded other income), and summaries derived from that ledger rather than re-joining
  every source table. See [Finance](#finance).
- **Phase 12 — Dashboard & Reports.** One KPI bundle reusing the finance and stock summaries
  rather than re-deriving them, plus a sales report, an inventory valuation report and a
  top-products report, each grouping in the database rather than folding rows in JavaScript.
  See [Dashboard](#dashboard) and [Reports](#reports).
- **Phase 13 — Audit & Settings.** An append-only trail written atomically alongside every
  security- and money-relevant change across every module - authentication, users, products,
  stock, orders, repairs, returns and finance - and a keyed settings store with type-checked
  values decoded at read time. See [Audit](#audit) and [Settings](#settings).

Not yet implemented (each is scheduled work, not a stub):

`apps/web` (Phase 14) and all UI phases (15-23) · full E2E suite (24) · performance and
security review (25) · production build (26).

A few items are deliberately deferred rather than half-built, each to the phase that owns
it:

- No password-change or password-reset endpoint yet.
- An order with a payment recorded against it cannot be cancelled; the way to unwind it is
  the returns workflow, which refunds and restocks together rather than one silently
  happening without the other.
- `Order.paymentStatus` never becomes `REFUNDED` here; only a return sets it.
- A repair has no warranty or rework flow: a device that comes back is taken in again as a
  new repair. The schema has nowhere to record the link, and inventing one would be
  guessing at a rule the specification does not state.

`packages/shared-types`, `packages/validation` and `apps/web` are reserved placeholders
containing only a `.gitkeep`; they become real workspace packages in Phases 21, 20 and 14.
`DATABASE_URL` and both JWT secrets are validated on startup; the API refuses to boot
without them.
