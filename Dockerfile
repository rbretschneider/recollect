# Recollect — single-container image: NestJS API + built Angular PWA.
# The photo library is mounted at /library and is only ever read in place
# (writes are limited to explicit trash/move operations).

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Reproducible, lockfile-pinned install. The lock now records the Linux native
# optional deps (sharp, esbuild) — the old npm/cli#4828 gap no longer applies on
# npm 11 — so `npm ci` builds deterministically from exactly what's committed.
RUN npm ci
COPY apps ./apps
RUN npm run build --workspace @recollect/server \
  && npm run build --workspace @recollect/web \
  && npm prune --omit=dev

FROM node:22-bookworm-slim
# perl: exiftool-vendored's exiftool is a perl program.
# postgresql-client-16: pg_dump for scheduled backups. It must match the server's
# major version (pgvector/pgvector:pg16) — bookworm ships 15, which refuses to
# dump a newer server — so it comes from the PGDG repo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends perl curl ca-certificates gnupg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
     | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
     > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y gnupg && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    APP_DATA_DIR=/app/data \
    WEB_DIST_DIR=/app/web/browser \
    MIGRATIONS_DIR=/app/drizzle
# The workspace layout is preserved so Node's module resolution matches what
# `npm ci` installed: some prod deps (the archiver tree) are nested under the
# server workspace to keep their versions isolated from root, so main.js must
# run from apps/server/dist to see apps/server/node_modules first, then the
# hoisted root node_modules. Flattening these into one dir would give root-level
# consumers the wrong versions.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /repo/apps/server/dist ./apps/server/dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
COPY --from=build /repo/apps/web/dist/web ./web
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -sf http://localhost:8080/api/v1/health || exit 1
CMD ["node", "apps/server/dist/main.js"]
