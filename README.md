# MCP Skills Manager

An [MCP](https://modelcontextprotocol.io) server that serves **skills** —
reusable markdown documents (instructions, playbooks, references) — to agents.
Write and organize skills in a web UI; agents load them over MCP.

Every skill is exposed two ways at once:

- as an MCP **tool** — calling it returns the skill's markdown body (plus a note
  listing any bundled supporting files), so an agent can pull a skill on demand;
- as an MCP **resource** at `skill://<name>` — for clients that browse and
  attach resources.

The root endpoint `/mcp` serves **all** skills. **Profiles** are named subsets
served at their own endpoint `/mcp/p/<slug>`, so you can hand a specific agent
just the skills it needs. Everything is also available over **stdio** for local
clients.

## Features

- 📝 **Markdown editor** in the web UI with live split-pane preview
- 🗂️ **Skill CRUD** — create, rename, edit, and delete skills
- 🧩 **Profiles** — group skills into filtered endpoints
- 📁 **Two skill formats** — a flat `<name>.md` file, or a
  `<name>/SKILL.md` directory (Claude Code convention) with supporting files
- 🔌 **HTTP and stdio** transports
- 🗃️ **Flat-file config** — hand-editable on disk, watched and hot-reloaded
- 🔐 **Bearer-token auth** guarding the API and MCP endpoints

## Quick start

```bash
npm install
npm run dev          # server on :3031, web UI on :3000 (proxies to the server)
```

Open http://localhost:3000. On first run a bearer token is generated into
`data/config/settings.json` and printed to the server logs; paste it into the
web UI when prompted.

### Production

```bash
npm run build        # shared → server → app
npm run start        # HTTP server on :3000, also serving the built web UI
```

Or with Docker:

```bash
docker compose up --build      # mounts ./data at /data, serves on :3000
```

## Connecting an agent

### HTTP

Point an MCP client at the streamable-HTTP endpoint:

- All skills: `http://localhost:3000/mcp`
- A profile: `http://localhost:3000/mcp/p/<slug>`

Send the bearer token as `Authorization: Bearer <token>`.

### stdio

Run the packaged stdio entry (installed as the `mcp-skills-stdio` bin):

```bash
# all skills
mcp-skills-stdio --data-dir /path/to/data

# only a profile's skills
mcp-skills-stdio --data-dir /path/to/data --profile <slug>
```

Example Claude Desktop / MCP client config:

```json
{
  "mcpServers": {
    "skills": {
      "command": "mcp-skills-stdio",
      "args": ["--data-dir", "/path/to/data", "--profile", "backend"]
    }
  }
}
```

## Skills on disk

Skills live under `DATA_DIR/skills/` in either of two shapes:

**Flat file** — `DATA_DIR/skills/commit-messages.md`:

```markdown
---
name: commit-messages
description: Write clear, conventional git commit messages.
---

# Writing good commit messages

...the skill body...
```

**Directory** (Claude Code convention) — `DATA_DIR/skills/pdf-forms/SKILL.md`
plus any supporting files (`reference.md`, scripts, templates). Supporting files
are listed on the skill and referenced in the rendered tool output so the agent
knows they exist.

The frontmatter `name` must be a slug: lowercase letters, digits, `.`, `_`, `-`
(max 64 chars). `description` is surfaced as the MCP tool/resource description.

## Profiles

A profile is a JSON file at `DATA_DIR/config/profiles/<slug>.json`:

```json
{
  "name": "Backend",
  "slug": "backend",
  "enabled": true,
  "description": "Skills for backend work.",
  "skills": ["commit-messages", "pdf-forms"]
}
```

It is served at `/mcp/p/backend` (HTTP) and via `--profile backend` (stdio).
Disabled profiles return 404. Manage profiles from the **Profiles** page in the
web UI, or edit the files directly — changes are picked up automatically.

## Configuration

Everything lives under `DATA_DIR` (default `./data`):

```
data/
├── config/
│   ├── settings.json          # port, auth token, auth toggle
│   └── profiles/
│       └── <slug>.json        # one file per profile
└── skills/
    ├── <name>.md              # flat-file skill
    └── <name>/                # directory-format skill
        ├── SKILL.md
        └── <supporting files>
```

Edits on disk are watched (debounced) and hot-reloaded; you can also force a
re-read with the **Reload** button on the Settings page or `POST /api/reload`.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Root directory for skills and config |
| `PORT` | `3000` (or `settings.json`) | HTTP listen port |
| `MCP_SKILLS_TOKEN` | — | Bearer token; overrides the one in `settings.json` |
| `SECURE_LOCAL_NET` | `false` | Set `true` to disable auth entirely (trusted networks only) |

If no token is configured and `SECURE_LOCAL_NET` is not set, a random token is
generated into `settings.json` on first run and logged.

## HTTP API

All routes require the bearer token (unless `SECURE_LOCAL_NET=true`).

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/status` | Version, uptime, skill/profile counts |
| `GET` | `/api/skills` | List skills (summaries) |
| `POST` | `/api/skills` | Create a skill |
| `GET` | `/api/skills/:name` | Get a skill (with body) |
| `PATCH` | `/api/skills/:name` | Update body/description, or rename |
| `DELETE` | `/api/skills/:name` | Delete a skill |
| `GET` | `/api/profiles` | List profiles |
| `POST` | `/api/profiles` | Create a profile |
| `GET` | `/api/profiles/:slug` | Get a profile |
| `PATCH` | `/api/profiles/:slug` | Update a profile |
| `DELETE` | `/api/profiles/:slug` | Delete a profile |
| `POST` | `/api/reload` | Re-read all config from disk |
| `ALL` | `/mcp` | MCP endpoint — all skills |
| `ALL` | `/mcp/p/:slug` | MCP endpoint — a profile's skills |

## Architecture

Monorepo with npm workspaces:

- **`shared/`** — zod schemas and inferred types; the single source of truth for
  config-file shapes and REST DTOs.
- **`server/`** — Express 5 + the MCP TypeScript SDK. A `ConfigStore` owns the
  flat-file state (atomic writes, chokidar watching); the gateway builds an MCP
  `Server` exposing skills as tools and resources over HTTP (stateless
  `StreamableHTTPServerTransport`) or stdio.
- **`app/`** — React 19 + Vite + shadcn/ui + TanStack Router/Query. The
  markdown editor uses `react-markdown` + `remark-gfm`.

See [`AGENTS.md`](AGENTS.md) for development conventions.

## License

MIT
