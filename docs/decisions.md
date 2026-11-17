# Architecture Decisions

1. Backend: Node.js + Express + TypeScript (single language across stack).
2. Queue: BullMQ on Redis (native Node, retries/backoff/repeatable jobs).
3. Repo: npm-workspaces monorepo.
4. Architecture: modular monolith with a separate worker process.
5. Local dev: Postgres + Redis in Docker Compose; apps run on the host with hot reload.
6. TypeScript 6 uses `module`/`moduleResolution` = `NodeNext` (the legacy `Node` resolution was removed). Packages stay CommonJS (no `"type": "module"`).
7. Shared code lives in packages/core (@flowforge/core): DSL, engine, logger, shutdown helper, queue factories, cron helpers, and enqueueExecution (dependencies passed in). Apps own their env, Postgres pool, and queue instances, so the worker no longer depends on API config.
8. Core is compiled to dist (CommonJS) and rebuilt by predev/pretypecheck/prebuild hooks. API tests alias core to its source. The web app imports only the types from @flowforge/core/dsl.
9. Docker: multi-stage images built from the repo root (apps/api/Dockerfile, apps/worker/Dockerfile) on node:24-bookworm-slim. Runtime images hold compiled output and production dependencies only, run as a non-root user, and start with an exec-form CMD so SIGTERM reaches the app. Compose services live behind an "app" profile. Install scripts are approved explicitly through allowScripts in the root package.json.