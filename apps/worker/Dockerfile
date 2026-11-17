# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/worker/Dockerfile -t flowforge-worker:local .

FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS toolchain
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

FROM toolchain AS manifests
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json

FROM manifests AS build
RUN npm ci --workspace=@flowforge/core --workspace=@flowforge/worker
COPY packages/core packages/core
COPY apps/worker apps/worker
# The worker build hook compiles @flowforge/core first.
RUN npm run build -w @flowforge/worker

FROM manifests AS prod-deps
RUN npm ci --omit=dev --workspace=@flowforge/core --workspace=@flowforge/worker

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
USER node
CMD ["node", "apps/worker/dist/index.js"]