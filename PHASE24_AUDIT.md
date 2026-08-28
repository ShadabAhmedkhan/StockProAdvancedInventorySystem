# PHASE 24 — StockPro Deep Production Readiness Audit

Evidence-based, read-only. No code was modified to produce this report.

---

## 1. Architecture findings

**FINDING**: Core architecture matches the documented design faithfully — tenant extension, Decimal money, conditional-UPDATE concurrency, and global guard chain are all present and consistent with README.md/CLAUDE.md.
- Evidence: `apps/api/src/prisma/tenant.extension.ts`, `apps/api/src/common/inventory/stock-operations.ts`, `apps/api/src/app.module.ts:79-85`.
- Severity: none (positive finding).

**MAINTAINABILITY** — Raw SQL bypasses the tenant Prisma extension by design.
- Evidence: `tenant.extension.ts` documents that `reports.service.ts`, `stock-operations.ts`, and `document-number.ts` use `$queryRaw`/`$executeRaw`, which the extension cannot intercept — those call sites must manually scope by `organizationId`.
- Why it matters: any future raw query added to these files (or a new one) that forgets to scope by org silently creates a cross-tenant data leak with no framework safety net.
- Recommended correction: add a lint rule or code-review checklist item flagging new `$queryRaw`/`$executeRaw` usage outside these three files; add a comment at each existing call site pointing back to this invariant (if not already present).
- Regression risk: none (documentation/process only).
- Required tests: none additional; existing tenant-isolation e2e already covers the ORM path.

---

## 2. Security findings

**P0 — SECURITY**: No password recovery flow — see full item in §9/§20 backlog. Related residual risk: no visible admin-initiated reset path either.

**MEDIUM — SECURITY**: No explicit request body-size limit configured.
- Evidence: no `express.json({ limit: ... })` or Nest `bodyParser` override found in `main.ts` / `app.setup.ts`.
- Why it matters: relies on Express defaults (~100kb), which is *probably* fine but is not an explicit, reviewed decision — a future dependency bump or body-parser config change could silently raise/lower it.
- Recommended correction: explicitly set a body size limit in `app.setup.ts` matching real upload requirements (attachments feature in Phase 30 will need this decision made deliberately).
- Regression risk: low — must confirm largest legitimate payload (e.g., bulk order line items) still fits.
- Required tests: one e2e test asserting an oversized payload is rejected with 413.

**LOW — SECURITY**: No Sentry/APM or structured logging (pino/winston).
- Evidence: no matches for `pino|winston|Sentry` under `apps/api/src`.
- Why it matters: production incidents will be debugged from unstructured Nest `Logger` output only — request-id middleware exists (`request-id.middleware.ts`) but isn't paired with structured/JSON log lines, weakening correlation in log aggregation tools.
- Recommended correction: adopt `nestjs-pino` (already convention-friendly with request-id) before production launch; defer APM/Sentry until traffic justifies cost.
- Regression risk: low, mostly additive.
- Required tests: none (infra concern).

**Positive finding**: Stripe webhook signature verification, Argon2id, refresh-token reuse detection, helmet+CSP, CORS allowlist, and rate limiting are all implemented correctly — see §6/§4 evidence.

---

## 3. Multi-tenancy findings

**FINDING**: Correctly implemented, verified by tests.
- Evidence: `tenant.extension.ts` (allow-listed `TENANT_MODELS`, org injected into where/data/upsert via AsyncLocalStorage), `apps/api/test/tenant-isolation.e2e-spec.ts:81,89-90,116,146-148,156,194,214,221-222` all assert `404` (not `403`) on cross-org access across customers/suppliers/categories/products/stock/orders/settings.
- Severity: none — this is the strongest-verified area of the codebase.
- Residual risk: the raw-SQL bypass noted in §1.

---

## 4. Authentication findings

**FINDING**: Matches spec.
- Argon2id: `apps/api/src/common/utils/password.util.ts:1` (`@node-rs/argon2`).
- Refresh rotation + reuse detection: `refresh-token.service.ts:72-98` — reuse of a revoked token triggers `revokeAllForUser` (line 89) and is logged as a warning (line 88); only a SHA-256 digest of the token is stored (line 32).
- Global guard chain: `app.module.ts:79-85` — `ThrottlerGuard → JwtAuthGuard → RolesGuard → ... → SubscriptionGuard`, all `APP_GUARD`.
- **MEDIUM — SECURITY/TESTING**: No password-reset flow means refresh-session revocation-on-reset (a spec requirement in Phase 25) currently has nothing to revoke against — this is a gap, not a bug, tracked in §20.

**DESIGN note**: `PlatformAdminController`/`PlatformAdminAuthGuard` intentionally sits outside the `APP_GUARD` chain as a separate trust boundary (`platform-admin-auth.guard.ts:34`). This is a deliberate design choice, not a defect, but worth a one-line architecture doc note so future contributors don't assume all routes share the tenant guard chain.

---

## 5. Authorization findings

**FINDING**: `@Public()`/`@Roles()` decorators exist and guard chain is deny-by-default (`RolesGuard` runs after `JwtAuthGuard` globally). No RBAC bypass found. Playwright has a dedicated `rbac.spec.ts`.
- Gap: RBAC is exercised e2e only for the modules with existing Playwright specs (auth, customers, dashboard, finance, orders, repairs, returns) — products, suppliers, categories/brands, stock, settings, users, audit, billing, reports have no RBAC-focused Playwright coverage. See §16 testing gaps.

---

## 6. Billing findings

**FINDING**: Correctly implemented.
- Webhook signature verification: `billing.controller.ts:58-66` (raw body + `stripe-signature` header, 400 if either missing) → `billing.service.ts:108-111` verifies via Stripe SDK, rejects bad signatures (confirmed by `billing.service.spec.ts:143-149`).
- `main.ts:16` sets `rawBody: true` specifically so the webhook sees untouched bytes.
- 402 gating: `subscription.guard.ts` throws `HttpException` with `HttpStatus.PAYMENT_REQUIRED` unless `ACTIVE` or `TRIALING`-with-future-`trialEndsAt` (~line 48-56); globally registered, bypassable only via `@SkipSubscriptionCheck()`.
- **MEDIUM — TESTING**: No `billing.e2e-spec.ts`. The webhook→DB-state path (subscription activated, trial converted, payment failed) is unit-tested (mocked Stripe client) but never exercised against the real database end-to-end.
  - Why it matters: unit tests can't catch a Prisma/transaction-boundary regression in the webhook handler (e.g., an update that silently fails to persist under the real DB's constraints).
  - Recommended correction: add `billing.e2e-spec.ts` simulating a signed webhook payload against the real API + DB for at least `checkout.session.completed`, `customer.subscription.updated`, `invoice.payment_failed`.
  - Regression risk: none (additive test only).

---

## 7. Database findings

**FINDING**: `Decimal(14,2)` and check constraints are used as designed per README (not independently re-verified against the live migration SQL in this pass, but `env.validation.ts` and `order-totals.ts`/`return-refunds.ts` evidence is consistent with this).
- No new issues found beyond what's already covered in §9 (inventory) and §1 (raw SQL tenant bypass risk).

---

## 8. Concurrency findings

**FINDING**: Correctly implemented per spec.
- `stock-operations.ts:19-25` doc comment plus four separate conditional-`UPDATE ... WHERE` `$executeRaw` call sites (lines ~55-58, 87-91, 138-140, 175-178).
- One dedicated concurrency e2e spec per hot module: `orders-concurrency`, `repairs-concurrency`, `returns-concurrency`, `stock-concurrency.e2e-spec.ts`.
- No `transfers-concurrency` or `stock-counts-concurrency` exist yet — expected, since Phases 33/35 (Transfers, Stock Counts) aren't implemented yet. Not a current gap, but a reminder for when those phases start: they must get their own concurrency e2e spec from day one, matching this project's established pattern.

---

## 9. Finance integrity findings

**FINDING**: Matches spec — `order-totals.ts` and `return-refunds.ts` are pure `Prisma.Decimal` functions with unit specs; `serialiseDecimalsAsFixedStrings()` (`decimal-json.ts:23-27`) overrides `toJSON` to fixed 2-decimal strings, wired once in `app.setup.ts:44` for both prod and e2e.
- No issues found.

---

## 10. Inventory integrity findings

**FINDING**: Matches spec — see §8. StockMovement rows are constructed alongside the same-transaction conditional UPDATE (lines 83, 134 in `stock-operations.ts`).
- Not independently re-verified: that `createMany` for `StockMovement` executes inside the *same* `tx` client instance in every call site (evidence gathered shows the arrays are built inline, consistent with the invariant, but a line-by-line confirmation of the enclosing `tx.stockMovement.createMany(...)` call wasn't captured for all four sites). **Recommend a quick manual read of `stock-operations.ts` in full before Phase 30+ reuses this module**, purely to confirm before extending it.

---

## 11. API findings

No REST convention violations found in this pass (envelope shape, pagination/sort whitelisting not independently re-audited this round — README documents them and no contradicting evidence surfaced). No `billing.controller.spec.ts` exists (controller-level unit test gap, low severity given e2e/service coverage elsewhere — see §16).

---

## 12. Frontend findings

**FINDING**: App Router structure is complete for all delivered modules (`dashboard/{audit,billing,customers,finance,inventory,orders,products,repairs,reports,returns,settings,suppliers,users}`).

**HIGH — MAINTAINABILITY**: No reusable data-table component exists.
- Evidence: only `entity-crud-page.tsx` (generic CRUD page shell) and `table-skeleton.tsx`; no `data-table.tsx` implementing sorting/filtering/column-visibility/saved-views/bulk-ops as Phase 27 §15 requires.
- Why it matters: Phase 27's data-table system (pagination, filters, sorting, column visibility, saved views, bulk operations) is a hard prerequisite named explicitly before further UI work — building it now, once, prevents each future module (Purchase Orders, Transfers, Stock Counts) from re-inventing table logic.
- Recommended correction: build one `DataTable` component now, migrate one existing page (e.g., Products) to prove it, then roll out incrementally — do not require all pages to migrate in one PR.
- Regression risk: medium if rolled out everywhere at once; low if done incrementally per page.
- Required tests: Vitest for the table component's sort/filter/pagination logic; one Playwright smoke test per migrated page.

**MEDIUM — DESIGN**: No command palette (Ctrl/Cmd+K) exists anywhere in `apps/web/src` (Phase 27 §14 requirement, not yet built — expected, not a defect, just confirming current state is "not started").

**LOW — MAINTAINABILITY**: UI kit is minimal — only `badge, button, card, dialog, input, label, select, skeleton, table-skeleton, textarea` under `components/ui/`. No `toast`, `dropdown-menu`, `tabs`, or `popover` primitives exist as files (a stray `toast.error(...)` reference surfaced during listing but no toast component file was found — worth a manual check before assuming toast notifications work anywhere).

---

## 13. UI/UX findings

**MEDIUM — DESIGN**: Loading/skeleton states exist (`skeleton.tsx`, `table-skeleton.tsx`) but no dedicated empty-state or error-state components were found. Standard Page UX states (Phase 29 §16: loading, skeleton, empty, populated, filtered-empty, permission-denied, API error, network error, mutation pending/success/failure) are very likely handled ad-hoc per page rather than via a shared pattern — this wasn't verified page-by-page, but the absence of a shared component is itself the finding.
- Recommended correction: build shared `EmptyState`/`ErrorState` components alongside the data-table work in §12, since both feed the same pages.

---

## 14. Accessibility findings

**MEDIUM — TESTING/DESIGN**: Extremely low explicit ARIA usage.
- Evidence: `grep -rho "aria-[a-z]*=" apps/web/src --include=*.tsx` → only 4 matches total across the entire frontend (3× `aria-label`, 1× `aria-pressed`), in only 3 files.
- Why it matters: even accounting for Radix/shadcn primitives injecting their own ARIA at runtime (not visible via static grep), 4 explicit attributes across a multi-page dashboard is low. No accessibility testing (`axe-core`, Playwright a11y assertions) exists in any Playwright spec.
- Recommended correction: add `@axe-core/playwright` to the existing Playwright suite and run it against each page as those pages get Playwright coverage (see §16) — cheapest way to get continuous a11y signal without a dedicated a11y-only effort.
- Regression risk: none (test-only addition).

---

## 15. Performance findings

Not independently re-benchmarked this pass (no evidence gathered on N+1 queries, missing indexes, or unbounded queries specifically — the audit agent's scope covered architecture/testing/security more than query-level performance). **This is a stated gap in this audit round, not a clean bill of health** — recommend a follow-up focused pass specifically grepping `reports.service.ts` and dashboard aggregation queries for `Promise.all` fan-out vs. single aggregate queries, per README's stated pattern of using DB aggregation.

---

## 16. Testing gaps

**Backend unit spec gaps**: `billing.controller.ts`, `platform-admin.service.ts`/`platform-admin.controller.ts`, `tenant.extension.ts` (only indirectly covered via e2e), `decimal-json.ts`, `prisma.service.ts` have no dedicated unit spec.

**Backend e2e gap**: no `billing.e2e-spec.ts` (§6).

**Frontend Vitest**: only 2 unit test files exist in the entire `apps/web` (`error-message.test.ts`, `format.test.ts`) — no component-level tests for any dashboard page or `entity-crud-page.tsx`.

**Playwright gap — HIGH**: specs exist only for `auth, customers, dashboard, finance, orders, rbac, repairs, returns`. **No Playwright coverage for: products, suppliers, categories/brands, stock/inventory, settings, users, audit, billing, reports** — despite all having live dashboard pages. This is the single largest testing gap in the repo relative to what's actually shipped.
- Recommended correction: add one Playwright smoke spec per uncovered page (golden path: list → create → edit → delete) before starting Phase 27+ UI work, so redesign work has a regression net.
- Regression risk: none (additive).

---

## 17. Production-readiness gaps

1. No password recovery (P0, §20).
2. No billing e2e coverage (P1).
3. No explicit body-size limit (P1).
4. No structured logging/Sentry (P2 — defer until traffic justifies).
5. Playwright coverage missing for 8 of 15 dashboard modules (P1).
6. No command palette / data-table system yet — expected, Phase 27 not started (P2, tracked as next phase, not a defect).

---

## 18. Technical debt

- Raw-SQL tenant-scoping bypass risk (§1) — process/lint gap, not a bug today.
- Minimal shadcn/ui component set will need expansion (toast, dropdown-menu, tabs, popover) before Phase 27 design work can proceed — flag now so it's budgeted, not discovered mid-redesign.

---

## 19. Recommended fixes (this phase, no large new features)

In priority order, matching §8 "Current Missing Production Work":
1. **Phase 25 — Password recovery** (P0, spec already defines the full flow — see below).
2. Add `billing.e2e-spec.ts` covering webhook → DB state (P1).
3. Fill Playwright gaps for the 8 uncovered dashboard modules (P1).
4. Explicit body-size limit + one 413 test (P1).
5. `@axe-core/playwright` wired into existing/new Playwright specs (P2).
6. Structured logging via `nestjs-pino` (P2, pairs with existing request-id middleware).
7. Manual full read of `stock-operations.ts` to confirm same-transaction StockMovement writes before Phase 30 reuses it (P1, cheap, high-confidence unblock).

---

## 20. Exact next implementation phase

Per this spec's own ordering (§8, §33): **PHASE 25 — Password Recovery** is next. It is P0 (security gap — no self-service recovery exists today), explicitly scoped in the spec (§10) with a full workflow (secure token → hashed storage → expiry → one-time use → generic response → throttling → Argon2id → audit event → refresh-session revocation → frontend pages → tests), and is called out ahead of Purchase Orders/POS/AI in the spec's own "First Task" instruction.

Before implementing, per the spec's execution protocol, I will (in a follow-up turn): inspect `apps/api/src/auth/*`, the Prisma schema for where a `PasswordResetToken` model belongs, `apps/api/src/common/utils/password.util.ts`, `apps/web/src/app/login/page.tsx` for the frontend pattern to mirror, and the existing throttler config — then present the PHASE/Current State/Problems/Architecture Decision/... breakdown required before writing code.

---

## Prioritized Implementation Backlog

- **P0 — must fix before production**
  - Phase 25: Password recovery flow (backend + frontend + tests).

- **P1 — important**
  - Billing webhook e2e test against real DB.
  - Playwright coverage for products, suppliers, categories/brands, stock, settings, users, audit, reports.
  - Explicit request body-size limit + 413 test.
  - Manual confirmation pass on `stock-operations.ts` transaction boundaries before Phase 30.
  - Data-table system (Phase 27 §15) — needed before further module UI work compounds the gap.

- **P2 — product improvement**
  - Structured logging (`nestjs-pino`).
  - `@axe-core/playwright` accessibility checks.
  - Expand shadcn/ui primitive set (toast, dropdown-menu, tabs, popover) ahead of Phase 27.
  - Command palette (Phase 27 §14).
  - Shared EmptyState/ErrorState components.

- **P3 — future enhancement**
  - APM/Sentry integration.
  - Query-level performance audit (deferred from this pass, §15).
  - Purchase Orders, Locations, Transfers, Barcode/Serial, Stock Counts, Reorder, POS, Notifications, Automation, Analytics expansion, CRM, AI layer — all explicitly deferred until P0/P1 above are done, per this spec's own stated priority order.
