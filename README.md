# MCP Skills Manager

An [MCP](https://modelcontextprotocol.io) server that serves **skills** —
reusable markdown documents (instructions, playbooks, references) — to agents.
Write and organize skills in a web UI; agents load them over MCP.

Every skill is exposed two ways at once:

- as an MCP **tool** — calling it returns the skill's markdown body (plus a note
  listing any bundled supporting files), so an agent can pull a skill on demand;
- as an MCP **resource** at `skill://<name>` — for clients that browse and
  attach resources.

Every endpoint also serves two meta-tools for **discovery**: `list_skills`
returns a JSON catalogue of the available skills — name, description, format,
tags, supporting files, and the tool name to call to load each — with no bodies,
and `search_skills` filters that catalogue by a free-text query and/or tags, so
an agent can find what's relevant by intent before loading anything.

Skills are advertised as tools in one of two modes (a global default, optionally
overridden per profile): **per-skill** (the default — one no-arg tool per skill)
or **loader** (a single `load_skill(name)` tool that keeps the tool footprint
fixed no matter how many skills exist).

Agents can also **author skills over MCP**: every endpoint exposes authoring
tools (`create_skill`, `update_skill`, `rename_skill`, `delete_skill`, plus
supporting-file tools) so an agent can write and refine its own skills. These
are gated on a setting (on by default).

The root endpoint `/mcp` serves **all** skills. **Profiles** are named subsets
served at their own endpoint `/mcp/p/<slug>`, so you can hand a specific agent
just the skills it needs. Everything is also available over **stdio** for local
clients.

## Features

- 📝 **Markdown editor** in the web UI with live split-pane preview
- 🗂️ **Skill CRUD** — create, rename, edit, delete, import (`.md`/dir/`.zip`),
  and export skills; drag-and-drop supporting files for directory-format skills
- 🧩 **Profiles** — group skills into filtered endpoints
- 🔍 **Discovery meta-tools** — `list_skills` and `search_skills` on every
  endpoint, plus `tags` on skills for organising and filtering
- 🤖 **MCP authoring** — agents can create and refine their own skills over MCP
- 🔧 **Tool modes** — advertise skills as one tool each (`per-skill`) or a
  single `load_skill` loader, globally or per profile
- 📁 **Two skill formats** — a flat `<name>.md` file, or a
  `<name>/SKILL.md` directory (Claude Code convention) with supporting files
- 🔌 **HTTP and stdio** transports
- 🗃️ **Flat-file config** — hand-editable on disk, watched and hot-reloaded
- 🔐 **Bearer-token auth** guarding the API and MCP endpoints

## Quick start

```bash
npm install
npm run dev          # server on :3001, web UI on :3000 (proxies to the server)
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
An optional `tags` key (a comma-separated string or a YAML list) organises
skills and feeds the `search_skills` filter. Unknown frontmatter keys are
preserved across round-trips.

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
Disabled profiles return 404. An optional `skillToolMode` (`per-skill` or
`loader`) overrides the global default for this profile only. Manage profiles
from the **Profiles** page in the web UI, or edit the files directly — changes
are picked up automatically.

## Configuration

Everything lives under `DATA_DIR` (default `./data`):

```
data/
├── config/
│   ├── settings.json          # port, auth token, auth/authoring toggles, tool mode
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
| `GET` | `/api/status` | Version, uptime, skill/profile counts, auth mode, port |
| `GET` | `/api/settings` | Read settings (auth/authoring toggles, tool mode) |
| `PATCH` | `/api/settings` | Update `authoringEnabled` / `skillToolMode` |
| `GET` | `/api/skills` | List skills (summaries) |
| `POST` | `/api/skills` | Create a skill |
| `POST` | `/api/skills/import` | Import an uploaded `.md` / directory / `.zip` |
| `GET` | `/api/skills/:name` | Get a skill (with body) |
| `PATCH` | `/api/skills/:name` | Update body/description/tags/global, or rename |
| `DELETE` | `/api/skills/:name` | Delete a skill |
| `GET` | `/api/skills/:name/export` | Download the skill as a `.zip` |
| `GET` | `/api/skills/:name/files/content?path=` | Read one supporting file |
| `PUT` | `/api/skills/:name/files` | Add/overwrite a supporting file (promotes to a dir) |
| `POST` | `/api/skills/:name/folders` | Create an empty sub-folder |
| `POST` | `/api/skills/:name/files/move` | Rename / move a file or folder |
| `DELETE` | `/api/skills/:name/files?path=` | Delete a file or folder |
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
