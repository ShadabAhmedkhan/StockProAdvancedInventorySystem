#!/bin/bash
#
# Production deploy for Stock Pro.
#
# Mirrors the same ordering rationale as every other app on this VPS:
#   1. Build everything BEFORE touching the database. A TypeScript error must
#      abort the deploy while production is still serving the old code
#      against the old schema, not after the schema has already moved.
#   2. Apply migrations with `prisma migrate deploy`, never `prisma db push`
#      — `db push` diffs the live database against schema.prisma and can
#      silently drop anything the schema doesn't describe.
#   3. Restart only after both the build and the migration succeeded.
#   4. Health-check, and fail loudly if the app does not come up.
set -Eeuo pipefail

APP_DIR=/var/www/StockProAdvancedInventorySystem
# Relative to apps/api, since `pnpm --filter @stock-pro/api exec` already runs
# from that package's directory — prefixing "apps/api/" again here silently
# resolves to a doubled, nonexistent path.
SCHEMA="prisma/schema.prisma"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:4000/api/v1/health}"
WEB_HEALTH_URL="${WEB_HEALTH_URL:-http://127.0.0.1:3002/login}"

log() { printf '\n[deploy] %s\n' "$*"; }
fail() { printf '\n[deploy][FATAL] %s\n' "$*" >&2; exit 1; }

trap 'fail "Deploy aborted at line $LINENO. Services were NOT restarted into a half-deployed state unless the failure occurred after the restart step."' ERR

cd "$APP_DIR"

log "Pulling latest code"
git pull origin main

log "Installing dependencies (locked)"
# `pnpm install --frozen-lockfile`, never a plain `pnpm install`: it installs
# exactly what pnpm-lock.yaml pins and fails if the lockfile and package.json
# disagree, so production is always reproducible.
pnpm install --frozen-lockfile

log "Generating Prisma client"
pnpm --filter @stock-pro/api prisma:generate

# ── Build BEFORE migrating ──────────────────────────────────────────────────
log "Building API and web"
pnpm build

# ── Only now touch the database ─────────────────────────────────────────────
log "Applying database migrations (migrate deploy)"
pnpm --filter @stock-pro/api exec prisma migrate deploy --schema="$SCHEMA"

log "Verifying migration state"
pnpm --filter @stock-pro/api exec prisma migrate status --schema="$SCHEMA" || fail "Migration status check failed — refusing to restart services."

# ── Restart ──────────────────────────────────────────────────────────────────
log "Restarting services"
pm2 restart stockpro-api --update-env
pm2 restart stockpro-web --update-env
pm2 save

# ── Health checks ────────────────────────────────────────────────────────────
check_health() {
  local name="$1" url="$2" attempts=30
  log "Health-checking $name at $url"
  for i in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      log "$name is healthy (attempt $i)"
      return 0
    fi
    sleep 2
  done
  fail "$name did not become healthy after $((attempts * 2))s. Check: pm2 logs $name"
}

check_health "stockpro-api" "$API_HEALTH_URL"
check_health "stockpro-web" "$WEB_HEALTH_URL"

log "Reloading nginx"
nginx -t
systemctl reload nginx

log "Deploy complete."
