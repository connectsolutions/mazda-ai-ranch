# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ranch: an agent deployment platform. A NestJS API submits Argo Workflows to Kubernetes,
which run agent pods; two Nuxt frontends (user `app`, operator `admin`) drive it. Bun +
Turborepo monorepo (`api`, `app`, `admin` workspaces, plus a standalone `cli` package).

## Commands

```bash
make setup            # First-time local setup: install + db + migrate + k3d
make dev              # Everything: api + app + admin + k3d + LightRAG
make dev-api          # One service at a time (also dev-app, dev-admin)
make down             # Stop dev servers, postgres, k3d
make build / lint / test
```

`make generate` regenerates `api/prisma/schema.prisma` from the per-slice `.prisma`
files, `make migrate` runs `generate` first and then Prisma migrate. Always go through
these rather than calling `prisma` directly: the schema is a build artifact and is
gitignored.

Single API test (jest, `rootDir: src`, `*.spec.ts`):

```bash
cd api && bunx jest src/slices/browser/data/browserless.client.spec.ts
```

Use `bunx jest` directly when iterating: `bun run test` triggers a `pretest` hook that
regenerates the Prisma schema on every invocation. `app` and `admin` have no tests and
no lint config yet; their `lint`/`test` scripts are echo stubs, so `make lint` and
`make test` only really exercise `api`.

## Local ports (README is stale on this)

| Service | Port | Set in |
|---|---|---|
| api | `PORT` from env, `3333` locally | `api/.env.dev` |
| app | 3000 | `app/package.json` (`nuxt dev --port 3000`) |
| admin | 3001 | `admin/package.json` (`nuxt dev --port 3001`) |

The README's "api:3000, app:3001, admin:3002" describes an older layout. `make free-ports`
and `make down` also kill a partly stale port set. Frontends reach the API through
`API_URL` / `NUXT_PUBLIC_API_URL` in `app/.env` and `admin/.env`, so those must point at
whatever port the API actually got.

## Env files

- `api/.env.dev` is the API's real config. NestJS loads `.env.${NODE_ENV || 'dev'}`
  (`api/src/app.module.ts`), so a plain `api/.env` is invisible to the app.
- `api/.env` is only read by `api/docker-compose.yml` for the LightRAG/Ollama profile.
- Root `.env` holds Hetzner + kubeconfig values for Terraform and k8s targets.
- All are gitignored; `.env.example` files are the tracked reference and drift ahead of
  local copies, so diff against them after pulling.

## CleanSlice architecture

Both API and frontends are organized as vertical slices, not by technical layer. A slice
owns its own module, routes, types, and Prisma model.

**API** (`api/src/slices/<slice>/<sub-slice>/`):

- `domain/` holds the abstract gateway (`export abstract class IXGateway`), types, and
  services. It never imports Prisma.
- `data/` implements that gateway against Prisma plus a mapper record -> entity.
- The module wires them with `{ provide: IXGateway, useClass: XGateway }`, so consumers
  inject the abstract class. Follow this when adding a slice; controllers stay thin and
  push logic into `domain/` services.
- Import across slices via the `#` alias (`#/agent/template/template.module`), which maps
  to `src/slices`. Circular slice pairs use `forwardRef()`.
- Each slice keeps its own `<name>.prisma` next to the module. `prisma-import` merges
  every `src/**/!(schema).prisma` into `api/prisma/schema.prisma`; `setup/prisma/prisma.prisma`
  carries the datasource and generator.

**Frontends** (`app/slices/`, `admin/slices/`): each slice is a Nuxt layer with its own
`nuxt.config.ts` that aliases itself (`#agent`) and auto-imports its `stores/`.
`registerSlices.ts` walks the tree and feeds them to `extends` in the root `nuxt.config.ts`.
Slices mirror the API's `domain/` + `data/` gateway split on top of a Pinia store. Adding a
slice means creating the directory with a `nuxt.config.ts`; nothing central needs editing.
Components auto-import with the directory prefix: `components/knowledge/Foo.vue` is
`<KnowledgeFoo>`, `components/knowledgeSources/Bar.vue` is `<KnowledgeSourcesBar>`. An
unprefixed `<Foo>` compiles but renders nothing (`.nuxt/components.d.ts` lists the names).

There is no vue-tsc; the frontends only get syntax-checked when Vite transforms them.
Fetching `http://localhost:3001/_nuxt/slices/<slice>/<file>` forces that transform for a
file without clicking through the UI (admin needs a login for most pages).

`useAsyncData` is a poor fit for a list the same page mutates (add / delete /
background poll). Its entries live in an app-wide cache keyed by string, get
neutralized when the last consumer unmounts (`purgeCachedData`), and `refresh()`
re-enters the "initial" path once that happens. Slices that own their data keep a
plain `ref` plus an explicit `load()` and a token guard against out-of-order
responses; keep `useAsyncData` for read-only views.

Anything heavy and synchronous belongs off the main thread: `forceAtlas2.assign`
over a graph of any size froze the tab for ~15s until it moved to
`graphology-layout-forceatlas2/worker`. That worker is built by stringifying a
function into a Blob URL, which survives the Vite production bundle - worth
re-checking in `admin/.output/public/_nuxt/` after any bundler change, since a
dev-only regression here is invisible until production.

## Running the API without a global `node`

`nest start` under Bun (which `bun run` substitutes when `node` is absent from PATH) resolves
`#/...` aliases straight into `src/*.ts` and trips over type-only imports. Put nvm's Node on
PATH first (`~/.nvm/versions/node/<v>/bin`); with real Node the Nest CLI rewrites aliases in
`dist` and everything runs as compiled JS. Same reason `make dev` works from an interactive
shell but not from a bare non-login one.

Local S3 is not configured by env: `S3Repository` reads `integrations/s3_endpoint`,
`aws_region`, `aws_access_key_id`, `aws_secret_access_key` from the settings table and caches
the client for the process lifetime. Set them (`PUT /settings/integrations/<name>`) to point
at MinIO (`http://localhost:9000`, `minioadmin`/`minioadmin`) and restart the API.

## Generated API client

`app` and `admin` call the API through a client generated by `openapi-ts` from
`api/swagger-spec.json`, which the API writes at boot in `main.ts`. Both frontends run
`scripts/wait-for-swagger.mjs` in `predev` because Turbo starts all three in parallel with
no ordering. Consequence: the API must boot successfully before the frontends can build
their client, and any controller/DTO change needs an API restart before the frontends see
the new methods.

## Agent runtime

`agent` slice -> `workflow` slice -> Argo Workflows -> pods in the `agents` namespace.
`make k3d` creates the local `ranch` cluster with the `platform` and `agents` namespaces
and applies `k8s/templates/rbac.yaml`; kubeconfig lands at `~/.kube/ranch-local.yaml`.
`dev-api` talks to Argo over `ARGO_WORKFLOWS_URL`, which needs `make pf-argo` running
unless `WORKFLOW_PROVIDER=mock`. Production is GitOps: ArgoCD syncs `k8s/` from the repo,
Terraform in `terraform/environments/<env>` owns the Hetzner infrastructure.

Related slices worth knowing before touching agent behavior: `bridle` (chat sessions and
streaming, transcripts stored as JSONL in S3/MinIO rather than Postgres), `reins`
(knowledge/RAG over LightRAG), `mcp` (MCP runtime served at `/mcp/*` via `@Tool`
decorators), `mcpServer` (registry of external MCP servers), `browser` (browserless pool;
see `api/src/slices/browser/README.md`).

## API response shape and CORS

A global `ResponseInterceptor` wraps handler returns in an envelope, so frontend stores
read `res.data?.data`. CORS is resolved per request in `main.ts`: the static
`CORS_ORIGIN` allowlist covers dashboard and admin, and `/api/agent/:agentId/...` routes
additionally accept origins from that agent's own `allowedOrigins` so embedded widgets
work on customer domains. Keep both paths in mind when adding public agent routes.
