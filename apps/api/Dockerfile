# Production image for @stock-pro/api.
#
# Must be built with the monorepo root as context, since this is a pnpm
# workspace package and needs the root lockfile/workspace manifest to
# resolve its dependency graph:
#
#   docker build -f apps/api/Dockerfile -t stockpro-api .
#
# Prisma runs through @prisma/adapter-pg (driver adapters), so there is no
# native query-engine binary to worry about across distros/libc - the
# generated client is plain JS/TS, compiled into dist like everything else.

FROM node:22-alpine AS base
RUN corepack enable

# ---------------------------------------------------------------------------
# deps: full workspace install (incl. devDependencies) to build from source.
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY apps/api/prisma ./apps/api/prisma
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build: compile TypeScript to dist (sourceMap disabled - see tsconfig.build.json).
# ---------------------------------------------------------------------------
FROM deps AS build
COPY packages/tsconfig ./packages/tsconfig
COPY apps/api ./apps/api
RUN pnpm --filter @stock-pro/api build

# ---------------------------------------------------------------------------
# prod-deps: a second, independent install with devDependencies excluded and
# lifecycle scripts skipped (the Prisma client this needs is already compiled
# into dist from the build stage - re-running `prisma generate` here would
# just fail anyway, since the `prisma` CLI itself is a devDependency).
# ---------------------------------------------------------------------------
FROM base AS prod-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts --filter @stock-pro/api...

# ---------------------------------------------------------------------------
# runtime: the actual production image - no build toolchain, no source.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S stockpro && adduser -S stockpro -G stockpro

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/package.json ./apps/api/package.json

USER stockpro
WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.API_PORT || 4000) + '/api/v1/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]
