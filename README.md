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
│   │   ├── src/common/       Filters, interceptors, middleware, error codes
│   │   ├── src/config/       Environment validation and typed app config
│   │   ├── src/health/       Liveness and readiness probes
│   │   └── test/             End-to-end (supertest) suite
│   └── web/                  Next.js App Router admin dashboard                -> Phase 14
├── packages/
│   ├── shared-types/         Framework-neutral shared types                    -> Phase 21
│   ├── validation/           Zod schemas shared by API and web                 -> Phase 20
│   ├── eslint-config/        Shared ESLint flat-config presets
│   └── tsconfig/             Shared TypeScript compiler presets
├── infrastructure/           Docker Compose (PostgreSQL)                       -> Phase 2
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

Local PostgreSQL runs in Docker (available from Phase 2):

```powershell
pnpm db:up        # start PostgreSQL
pnpm db:status    # container status
pnpm db:logs      # follow logs
pnpm db:down      # stop
```

### Prisma migrations and seed

```powershell
pnpm --filter @stock-pro/api prisma:migrate     # apply migrations (dev)
pnpm --filter @stock-pro/api prisma:generate    # regenerate the client
pnpm --filter @stock-pro/api db:seed            # load development seed data
```

Development seed credentials are documented once the seed exists (Phase 2). They are for
local development only and must never be used as production defaults.

---

## Commands

Run from the repository root.

| Command                                            | Description                                       |
| -------------------------------------------------- | ------------------------------------------------- |
| `pnpm dev`                                         | Run every app in watch mode                       |
| `pnpm dev:api`                                     | Run the API only                                  |
| `pnpm dev:web`                                     | Run the web app only                              |
| `pnpm build`                                       | Build every workspace package in dependency order |
| `pnpm lint`                                        | ESLint across the monorepo                        |
| `pnpm lint:fix`                                    | ESLint with autofix                               |
| `pnpm typecheck`                                   | TypeScript project build + per-package typechecks |
| `pnpm test`                                        | Unit and integration tests                        |
| `pnpm test:e2e`                                    | End-to-end tests                                  |
| `pnpm format`                                      | Prettier write                                    |
| `pnpm format:check`                                | Prettier check                                    |
| `pnpm db:up` / `db:down` / `db:logs` / `db:status` | Local PostgreSQL lifecycle                        |

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

Not yet implemented (each is scheduled work, not a stub):

database and Prisma schema (Phase 2) · authentication (3) · customers (4) · suppliers (5) ·
product catalog (6) · inventory (7) · orders (8) · repairs (9) · returns (10) · finance (11) ·
dashboard and reports (12) · audit and settings (13) · `apps/web` (14) and all UI phases
(15-23) · full E2E suite (24) · performance and security review (25) · production build (26).

The `packages/shared-types`, `packages/validation`, `apps/web` and `infrastructure`
directories are reserved placeholders containing only a `.gitkeep`; they become real
workspace packages in the phases noted above. The `db:*` root scripts reference
`infrastructure/docker-compose.yml`, which arrives in Phase 2. `DATABASE_URL` and the JWT
secrets appear in `.env.example` but are not yet validated on startup: each is added to the
environment schema by the phase that first needs it, so from that point the API refuses to
boot without them.
