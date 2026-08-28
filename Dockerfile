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
RUN apt-get update \
  && apt-get install -y --no-install-recommends perl curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    APP_DATA_DIR=/app/data \
    WEB_DIST_DIR=/app/web/browser \
    MIGRATIONS_DIR=/app/drizzle
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
COPY --from=build /repo/apps/web/dist/web ./web
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -sf http://localhost:8080/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
