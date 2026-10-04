# MCP Skills Manager

An [MCP](https://modelcontextprotocol.io) server that serves **skills** —
reusable markdown documents (instructions, playbooks, references) — to agents.
Write and organize skills in a web UI; agents load them over MCP.

Every skill is exposed two ways at once:

- as an MCP **tool** — calling it returns the skill's markdown body (plus a note
  listing any bundled supporting files), so an agent can pull a skill on demand;
- as an MCP **resource** at `skill://<name>` — for clients that browse and
  attach resources. Bundled supporting files are resources too
  (`skill://<name>/<path>`), the endpoint advertises RFC 6570 **resource
  templates** with argument **completion** (skill names and file paths), and
  `resources/list` is **paginated**. Clients that subscribe get **live updates**
  (`resources/list_changed` + `resources/updated`) when skills change on disk —
  always over stdio, and over HTTP when `httpLiveUpdates` is enabled.

Every endpoint also serves two meta-tools for **discovery**: `list_skills`
returns a JSON catalogue of the available skills — name, description, format,
tags, supporting files, and the tool name to call to load each — with no bodies,
and `search_skills` filters that catalogue by a free-text query and/or tags, so
an agent can find what's relevant by intent before loading anything.

Skills are advertised as tools in one of two modes (a global default, optionally
overridden per workspace): **per-skill** (the default — one no-arg tool per skill)
or **loader** (a single `load_skill(name)` tool that keeps the tool footprint
fixed no matter how many skills exist).

Agents can also **author skills over MCP**: every endpoint exposes authoring
tools (`create_skill`, `update_skill`, `rename_skill`, `delete_skill`, plus
supporting-file tools) so an agent can write and refine its own skills. These
are gated on a setting (on by default). To protect an individual skill, mark it
**read-only** (the toggle in the skill editor, or `readonly: true` in its
frontmatter): agents can still load it, but every authoring tool refuses to
edit, rename or delete it — or, for a directory skill, anything in its folder.

The root endpoint `/mcp` serves **all** skills. **Workspaces** are named subsets
served at their own endpoint `/mcp/w/<slug>`, so you can hand a specific agent
just the skills it needs. Everything is also available over **stdio** for local
clients.

## Features

- 📝 **Markdown editor** in the web UI with live split-pane preview
- 🗂️ **Skill CRUD** — create, rename, edit, delete, import (`.md`/dir/`.zip`),
  and export skills; drag-and-drop supporting files for directory-format skills
- 🌿 **Git-linked skills** — point a skill at a folder in a git repo and pull
  the newest version with **Sync now**
- 🧩 **Workspaces** — group skills into filtered endpoints
- 🔍 **Discovery meta-tools** — `list_skills` and `search_skills` on every
  endpoint, plus `tags` on skills for organising and filtering
- 🤖 **MCP authoring** — agents can create and refine their own skills over MCP
- 🔧 **Tool modes** — advertise skills as one tool each (`per-skill`) or a
  single `load_skill` loader, globally or per workspace
- 📁 **Two skill formats** — a flat `<name>.md` file, or a
  `<name>/SKILL.md` directory (Claude Code convention) with supporting files
- 🔌 **HTTP and stdio** transports
- 📡 **Live resource updates** — subscribers are notified when skills change on
  disk (always over stdio; over HTTP with `httpLiveUpdates`)
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
- A workspace: `http://localhost:3000/mcp/w/<slug>`

Send the bearer token as `Authorization: Bearer <token>`.

### stdio

Run the packaged stdio entry (installed as the `mcp-skills-stdio` bin):

```bash
# all skills
mcp-skills-stdio --data-dir /path/to/data

# only a workspace's skills
mcp-skills-stdio --data-dir /path/to/data --workspace <slug>
```

Example Claude Desktop / MCP client config:

```json
{
  "mcpServers": {
    "skills": {
      "command": "mcp-skills-stdio",
      "args": ["--data-dir", "/path/to/data", "--workspace", "backend"]
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
skills and feeds the `search_skills` filter. `readonly: true` stops agents from
modifying the skill over MCP (the web UI and REST API can still edit it).
Unknown frontmatter keys are preserved across round-trips.

### Git-linked skills

A skill can be linked to a folder in a git repo — a published skill you want
this server to track rather than copy once. In the web UI use **New skill →
From Git**, or the **Link to Git source** button on an existing skill (which
replaces its content). Give a clone URL, optionally a branch or tag (blank
follows the default branch) and the folder holding the `SKILL.md` (blank is the
repo root); pasting a GitHub/GitLab folder link such as
`https://github.com/owner/repo/tree/main/skills/my-skill` fills all three.

The link is stored in the skill's frontmatter, with the commit the last sync
fetched:

```markdown
---
name: my-skill
description: …
source:
  repo: https://github.com/owner/repo
  ref: main            # optional
  path: skills/my-skill  # optional
  commit: 4f2a9c1…     # written by sync
  syncedAt: 2026-10-04T12:00:00.000Z
---
```

- **Sync is manual.** *Sync now* (or `POST /api/skills/:name/sync`) replaces the
  skill's whole folder with the repo's copy; files removed upstream are removed
  here. Nothing syncs on a timer.
- **Linked skills are locked.** Their content cannot be edited in the web UI,
  over the REST API or by agents over MCP. **Unlink** keeps the current content
  and makes the skill a normal, editable one again.
- **Local settings survive a sync:** the skill's id here (even when the repo's
  `SKILL.md` names it differently), `global`, `readonly` and workspace
  membership. The skill can still be renamed and deleted.
- **Repo URLs** must be `https://…`, `ssh://…` or `user@host:path`. An https URL
  may not embed a username or token — the URL is written into `SKILL.md`, which
  agents read. Symlinks in the repo folder are skipped, and a folder may hold at
  most 500 files.
- **Private repos** use the credentials of the machine (or container) running
  the server: an SSH key the server's user can read, or a git credential helper
  for https. git never prompts — a repo it cannot read fails the sync with git's
  own error. With Docker, mount a key and `known_hosts` (e.g.
  `-v ~/.ssh:/root/.ssh:ro`).
- **`git` must be on the server's `PATH`.** The Docker image ships it.

## Workspaces

A workspace is a JSON file at `DATA_DIR/config/workspaces/<slug>.json`:

```json
{
  "name": "Backend",
  "slug": "backend",
  "enabled": true,
  "description": "Skills for backend work.",
  "skills": ["commit-messages", "pdf-forms"]
}
```

It is served at `/mcp/w/backend` (HTTP) and via `--workspace backend` (stdio).
Disabled workspaces return 404. An optional `skillToolMode` (`per-skill` or
`loader`) overrides the global default for this workspace only. Manage workspaces
from the **Workspaces** page in the web UI, or edit the files directly — changes
are picked up automatically.

## Configuration

Everything lives under `DATA_DIR` (default `./data`):

```
data/
├── config/
│   ├── settings.json          # port, auth token, auth/authoring toggles, tool mode, httpLiveUpdates
│   └── workspaces/
│       └── <slug>.json        # one file per workspace
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
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | `75000` | How long an idle client connection stays open (Node's own default is 5 s). Keep it above the idle timeout of any reverse proxy in front; `0` never closes one |

If no token is configured and `SECURE_LOCAL_NET` is not set, a random token is
generated into `settings.json` on first run and logged.

## HTTP API

All routes require the bearer token (unless `SECURE_LOCAL_NET=true`).

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/status` | Version, uptime, skill/workspace counts, auth mode, port |
| `GET` | `/api/settings` | Read settings (auth/authoring toggles, tool mode, live updates) |
| `PATCH` | `/api/settings` | Update `authoringEnabled` / `skillToolMode` / `httpLiveUpdates` |
| `GET` | `/api/skills` | List skills (summaries) |
| `POST` | `/api/skills` | Create a skill |
| `POST` | `/api/skills/import` | Import an uploaded `.md` / directory / `.zip` |
| `POST` | `/api/skills/import-git` | Create a skill linked to a folder in a git repo |
| `GET` | `/api/skills/:name` | Get a skill (with body) |
| `PATCH` | `/api/skills/:name` | Update body/description/tags/global/readOnly, or rename |
| `DELETE` | `/api/skills/:name` | Delete a skill |
| `PUT` | `/api/skills/:name/source` | Link a skill to a git source and replace its content from it |
| `DELETE` | `/api/skills/:name/source` | Unlink it, keeping its content |
| `POST` | `/api/skills/:name/sync` | Re-fetch a linked skill → `{ skill, changed }` |
| `GET` | `/api/skills/:name/export` | Download the skill as a `.zip` |
| `GET` | `/api/skills/:name/files/content?path=` | Read one supporting file |
| `PUT` | `/api/skills/:name/files` | Add/overwrite a supporting file (promotes to a dir) |
| `POST` | `/api/skills/:name/folders` | Create an empty sub-folder |
| `POST` | `/api/skills/:name/files/move` | Rename / move a file or folder |
| `DELETE` | `/api/skills/:name/files?path=` | Delete a file or folder |
| `GET` | `/api/workspaces` | List workspaces |
| `POST` | `/api/workspaces` | Create a workspace |
| `GET` | `/api/workspaces/:slug` | Get a workspace |
| `PATCH` | `/api/workspaces/:slug` | Update a workspace |
| `DELETE` | `/api/workspaces/:slug` | Delete a workspace |
| `POST` | `/api/reload` | Re-read all config from disk |
| `ALL` | `/mcp` | MCP endpoint — all skills |
| `ALL` | `/mcp/w/:slug` | MCP endpoint — a workspace's skills |

## Architecture

Monorepo with npm workspaces:

- **`shared/`** — zod schemas and inferred types; the single source of truth for
  config-file shapes and REST DTOs.
- **`server/`** — Express 5 + the MCP TypeScript SDK. A `ConfigStore` owns the
  flat-file state (atomic writes, chokidar watching); the gateway builds an MCP
  `Server` exposing skills as tools and resources over HTTP
  (`StreamableHTTPServerTransport` — stateless by default, or stateful sessions
  with SSE push when `httpLiveUpdates` is on) or stdio.
- **`app/`** — React 19 + Vite + shadcn/ui + TanStack Router/Query. The
  markdown editor uses `react-markdown` + `remark-gfm`.

See [`AGENTS.md`](AGENTS.md) for development conventions.

## License

MIT
