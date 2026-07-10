# SPEC — Skill-management roadmap

Deferred enhancements from the skill-management review. The items already
shipped on `feat/skill-management-enhancements` are checked off; the rest are
scoped todos for future work. Effort tags: `(S)` small, `(M)` medium, `(L)`
large. ⭐ marks the highest-leverage picks.

## Shipped

- [x] **B0 · Surface the `authoringEnabled` toggle in Settings** — control the
      global agent-authoring flag from the UI instead of hand-editing
      `settings.json`.
- [x] **A1 · Search, filter, and sort the skill list** — free-text search plus
      scope/format/tag filters and name/updated/most-used sorting.
- [x] **A2 · Tags / categories** — normalized `tags` frontmatter, round-tripped
      through the schema, REST API, MCP catalogue, and the editor; drives the
      list filter.
- [x] **B1 · Usage analytics** ⭐ — per-skill load count + last-used timestamp,
      persisted to `DATA_DIR/usage.json` (outside the watched dirs), surfaced as
      list columns and a "most used" sort.
- [x] **B6 · `search_skills` MCP tool** — full-text search over skill name,
      description, tags, and body (plus a tag filter) for agents, returning the
      body-less catalogue shape.
- [x] **C1 · `skill://` resource metadata (Tier 1)** — resource listings now
      carry `size` on bundled files, `annotations.lastModified` (= `updatedAt`)
      and `annotations.audience: ["assistant"]`, and unknown resources return the
      spec's `-32002` (resource-not-found) code with the URI in `data` instead of
      generic `InvalidParams`.
- [x] **C2 · Live resource updates over stdio (Tier 2)** — the long-lived stdio
      server advertises `resources.listChanged` + `subscribe` and pushes
      `notifications/resources/list_changed` (and `resources/updated` for
      subscribed URIs) when the store reloads after an on-disk edit. Wired via
      the `ConfigStore` `change` event. The HTTP route omits it by default (a
      stateless server can't push); C3 below extends the same push to HTTP behind
      an opt-in stateful mode.

## Theme A — Better management UX

- [ ] **A3 · "Preview as the agent sees it"** *(S)* — Show the exact
      `renderSkill` output (body + metadata footer + bundled-file footer) and
      the `list_skills` catalogue entry in the editor. Demystifies what actually
      reaches the model.
- [ ] **A4 · Clone a skill + manage workspace membership from the skill page**
      *(S)* — Duplicate-as-starting-point, and a "Workspaces" checklist on the
      skill so it can be added to / removed from workspaces without opening each
      workspace.

## Theme B — Better agent self-improvement

- [ ] **B2 · Draft / review queue for agent-authored skills** *(M)* ⭐ — Agents
      author into `draft: true` (served only to the author's endpoint, or not at
      all) and a human approves/publishes in the UI. Human-in-the-loop
      governance — the safe way to leave `authoringEnabled` on.
- [ ] **B3 · Version history + diff + revert** *(L)* — Snapshot on every write
      (`.history/` or git-backed), with a diff view and one-click revert. Audit
      exactly what an agent changed and undo bad self-edits. Highest effort,
      strongest trust story.
- [ ] **B4 · Authoring guardrails** *(M)* — Per-workspace authoring toggle (today
      it's global-only), "protected" skills agents can't edit/delete, and an
      audit log of who-created/edited-what. (Subsumes the earlier "B7 · workspace
      authoring tools" idea — per-workspace control lands here.)
- [ ] **B5 · An authoring guide the agent actually reads + create-time
      templates** *(S–M)* — A built-in meta-skill / scaffolded template so
      self-authored skills follow good structure (clear description, when-to-use,
      ref-file splitting). Improves the *quality* of self-improvement, not just
      the mechanics.

## Theme C — MCP resource conformance

Gaps between our `skill://` resource surface and the [MCP 2025-06-18 Resources
spec](https://modelcontextprotocol.io/specification/2025-06-18/server/resources).
Tier 1 (metadata) and Tier 2 (stdio live updates) shipped above; the rest:

- [x] **C3 · Live resource updates over HTTP** — an opt-in **stateful** mode for
      the HTTP `/mcp` endpoints (`settings.httpLiveUpdates`, default off): an
      `McpSessionManager` keeps a persistent `Server` + transport per
      `Mcp-Session-Id` (minted on initialize), wires `onSkillsChanged` the way
      stdio does, and pushes `notifications/resources/list_changed` +
      `resources/updated` over the client's SSE stream. Stateless (a fresh server
      per request) stays the default; the mode is read fresh per request so the
      toggle needs no restart. Sessions are torn down on client disconnect/DELETE.
- [x] **C4 · Resource templates + argument completion** — `resources/templates/list`
      advertises two RFC 6570 templates (`skill://{name}` and, when file reads are
      wired, `skill://{name}/{+path}` — reserved expansion so nested paths keep their
      `/`), and a `completion/complete` handler autocompletes skill names for `{name}`
      and a skill's bundled-file paths for `{+path}` (scoped by the `name` already
      chosen via completion `context`). The `completions` capability is declared.
- [x] **C5 · `resources/list` pagination** — the resource list honors the
      `cursor` / `nextCursor` protocol, paging at 100 resources with opaque
      base64url offset cursors (stateless-safe); a malformed cursor is a clean
      `InvalidParams` (-32602).
- [x] **C6 · Resource `title` + URI-encoding round-trip fix** — an optional
      human-readable `title` (from frontmatter, distinct from the slug `name`)
      rides the resource listing, and bundled-file path segments are
      percent-encoded when building the advertised `skill://<name>/<path>` URI so
      it round-trips through the `decodeURIComponent` read path for filenames
      containing `%`, spaces, etc.
