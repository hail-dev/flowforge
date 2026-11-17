# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/api/Dockerfile -t flowforge-api:local .

FROM node:24-bookworm-slim AS base
WORKDIR /app

# bcrypt normally installs a prebuilt binary but compiles from source if none matches.
FROM base AS toolchain
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

 # Package manifests only, so dependency layers stay cached until a package.json or the lockfile changes.
FROM toolchain AS manifests
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json

FROM manifests AS build
RUN npm ci --workspace=@flowforge/core --workspace=@flowforge/api
COPY packages/core packages/core
COPY apps/api apps/api
# The api build hook compiles @flowforge/core first.
RUN npm run build -w @flowforge/api

FROM manifests AS prod-deps
RUN npm ci --omit=dev --workspace=@flowforge/core --workspace=@flowforge/api

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/index.js"]