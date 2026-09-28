# Architecture Decisions

1. Backend: Node.js + Express + TypeScript (single language across stack).
2. Queue: BullMQ on Redis (native Node, retries/backoff/repeatable jobs).
3. Repo: npm-workspaces monorepo.
4. Architecture: modular monolith with a separate worker process.
5. Local dev: Postgres + Redis in Docker Compose; apps run on the host with hot reload.
6. TypeScript 6 uses `module`/`moduleResolution` = `NodeNext` (the legacy `Node` resolution was removed). Packages stay CommonJS (no `"type": "module"`).