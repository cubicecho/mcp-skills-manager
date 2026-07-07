# AGENTS.md — MCP Skills Manager

MCP Skills Manager is an MCP server that serves **skills** — markdown documents
(instructions, playbooks, references) — to agents over MCP. Each skill is
exposed both as an MCP **tool** (calling it returns the skill body) and as an
MCP **resource** (`skill://<name>`). The root endpoint `/mcp` serves every
skill; **profiles** are named subsets served at `/mcp/p/<slug>` (the analog of
mcp-router's projects). The same content is also available over **stdio** for
local clients (`mcp-skills-stdio`, optionally `--profile <slug>`).
Configuration lives in hand-editable flat files under `DATA_DIR`; a React web
UI provides a markdown editor and CRUD for skills and profiles.

Skills come in two on-disk shapes, both supported:
- **Flat file:** `DATA_DIR/skills/<name>.md`
- **Directory (Claude Code convention):** `DATA_DIR/skills/<name>/SKILL.md`
  plus any supporting files, which are listed on the skill and mentioned in the
  rendered tool output.

Both use YAML frontmatter (`name`, `description`) followed by the markdown body.

Monorepo (npm workspaces): `shared/` (zod schemas + types — the contract),
`server/` (Express 5 + MCP TS SDK), `app/` (React + Vite + shadcn/ui).

## Commands

All from the project root.

```bash
# Dev
npm run dev              # server (watch) + Vite dev server, concurrently
npm run dev:server       # Express + MCP server only (port 3001, DATA_DIR=./data)
npm run dev:app          # Vite dev server only (port 3000, proxies /api + /mcp)

# Quality — run before every commit
npm run check            # biome check + tsc --noEmit for all packages
npm run check:fix        # biome with auto-fix
npm run lint / lint:fix  # biome lint only
npm test                 # vitest run

# Build / deploy
npm run build            # shared typecheck → server tsc → app vite build
npm run start            # node server/dist/index.js (serves app/dist over HTTP)
npm run stdio            # node server/dist/stdio.js (stdio MCP transport)
npm run build:docker     # docker build -t mcp-skills-manager .
docker compose up        # run the container; ./data mounted at /data
```

## Tech Stack

| Choice | Why |
| --- | --- |
| **Biome** | Single formatter+linter; enforces `useImportType`, `noUnusedImports` |
| **Express 5 + @modelcontextprotocol/sdk** | `StreamableHTTPServerTransport` (stateless) for `/mcp`; `StdioServerTransport` for the CLI entry. One `Server` per request/process exposing tools + resources |
| **Flat-file config** | `DATA_DIR/config/{settings.json,profiles/<slug>.json}` (JSON) + `DATA_DIR/skills/<name>.md` or `<name>/SKILL.md` (Markdown + YAML frontmatter); hand-editable, watched (chokidar, debounced) + `POST /api/reload`; atomic writes, mode 0600 |
| **Node ≥22.18 type stripping** | Server dev runs `.ts` directly (`node --watch`), no build step; `tsc` with `rewriteRelativeImportExtensions` emits `dist/` for prod — so **use `.ts` extensions in all relative imports** in `server/` and `shared/` |
| **Vite + React 19 + shadcn/ui + TanStack Router/Query** | Same frontend stack as sibling repos — plain REST with shared zod DTOs; `react-markdown` + `remark-gfm` for the editor preview |
| **Single bearer token auth** | `MCP_SKILLS_TOKEN` env or generated into settings.json; guards `/api/*` and `/mcp*`; `SECURE_LOCAL_NET=true` disables auth entirely (trusted-network escape hatch) |

## Key Conventions

**The `shared/` package is the contract.** Config-file shapes and REST DTOs are
zod schemas in `shared/src/`. The server validates with them at every boundary
(config load, request bodies); the app imports the inferred types via
`@mcp-skills/shared`. Never duplicate these shapes — extend the schema and let
types flow.

**Type inference — never hand-write types zod can infer:**
```typescript
export type Skill = z.infer<typeof skillSchema>;
```

**Validate at boundaries, trust inside:**
```typescript
const input = createSkillRequestSchema.parse(req.body); // throws → 400 via error middleware
```

**Config writes are atomic:** write to a temp file in the same dir, `chmod
0600`, then `rename`. Skill frontmatter parses leniently (`.passthrough()`) so
hand-added keys survive round-trips.

**Skill names are slugs:** `^[a-z0-9][a-z0-9._-]*$`, max 64. Names double as
tool names (dots sanitized to `_` for the MCP tool name) and resource URIs
(`skill://<name>`). Invalid on-disk names are skipped with a warning, never
crash the load.

**Frontend:** shadcn/ui primitives in `app/src/components/ui/` (no app logic
there); feature components in `app/src/components/domain/`; file-based routes in
`app/src/routes/`; `@/` maps to `app/src/`. Data fetching via TanStack Query
hooks wrapping the typed client in `src/lib/api.ts` — no raw `fetch` in
components. Invalidate the relevant query keys after every mutation.

## Code Style

- Biome-enforced: single quotes, semicolons, trailing commas, 2-space indent,
  120 line width, `import type` for type-only imports, arrow parens always
- Files `kebab-case.ts(x)`; components `PascalCase`; vars/functions
  `camelCase`; types/interfaces `PascalCase`; true constants
  `SCREAMING_SNAKE_CASE`
- Prefix unused params with `_`
- `unknown` over `any` (`noExplicitAny` warns)

## Git

- `git pull --no-rebase` (merge, not rebase)
- Run `npm run check` before every commit
- Use **Conventional Commits** (`feat: …`, `fix: …`, `chore: …`, breaking
  changes via `!` or `BREAKING CHANGE:`)

## Finding code

Prefer an LSP (definitions/references) over grep when navigating the codebase.
