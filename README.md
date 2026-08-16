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
│   │   ├── src/common/       Filters, interceptors, middleware, error codes
│   │   ├── src/config/       Environment validation and typed app config
│   │   ├── src/health/       Liveness and readiness probes
│   │   ├── src/prisma/       PrismaService and the global PrismaModule
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
| API base        | http://localhost:4000/api/v1             |
| Swagger UI      | http://localhost:4000/api/docs           |
| OpenAPI JSON    | http://localhost:4000/api/docs-json      |
| Readiness probe | http://localhost:4000/api/v1/health      |
| Liveness probe  | http://localhost:4000/api/v1/health/live |

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

Not yet implemented (each is scheduled work, not a stub):

authentication (Phase 3) · customers (4) · suppliers (5) · product catalog (6) ·
inventory (7) · orders (8) · repairs (9) · returns (10) · finance (11) · dashboard and
reports (12) · audit and settings (13) · `apps/web` (14) and all UI phases (15-23) ·
full E2E suite (24) · performance and security review (25) · production build (26).

The tables exist and are constrained, but only the health endpoints are exposed so far;
each business module lands in the phase listed above.

`packages/shared-types`, `packages/validation` and `apps/web` are reserved placeholders
containing only a `.gitkeep`; they become real workspace packages in Phases 21, 20 and 14.
`DATABASE_URL` is validated on startup. The JWT secrets appear in `.env.example` but are
not yet in the environment schema; they are added in Phase 3, and from that point the API
refuses to boot without them.
