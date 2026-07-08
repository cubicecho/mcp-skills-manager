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

## Theme A — Better management UX

- [ ] **A3 · "Preview as the agent sees it"** *(S)* — Show the exact
      `renderSkill` output (body + metadata footer + bundled-file footer) and
      the `list_skills` catalogue entry in the editor. Demystifies what actually
      reaches the model.
- [ ] **A4 · Clone a skill + manage profile membership from the skill page**
      *(S)* — Duplicate-as-starting-point, and a "Profiles" checklist on the
      skill so it can be added to / removed from profiles without opening each
      profile.

## Theme B — Better agent self-improvement

- [ ] **B2 · Draft / review queue for agent-authored skills** *(M)* ⭐ — Agents
      author into `draft: true` (served only to the author's endpoint, or not at
      all) and a human approves/publishes in the UI. Human-in-the-loop
      governance — the safe way to leave `authoringEnabled` on.
- [ ] **B3 · Version history + diff + revert** *(L)* — Snapshot on every write
      (`.history/` or git-backed), with a diff view and one-click revert. Audit
      exactly what an agent changed and undo bad self-edits. Highest effort,
      strongest trust story.
- [ ] **B4 · Authoring guardrails** *(M)* — Per-profile authoring toggle (today
      it's global-only), "protected" skills agents can't edit/delete, and an
      audit log of who-created/edited-what. (Subsumes the earlier "B7 · profile
      authoring tools" idea — per-profile control lands here.)
- [ ] **B5 · An authoring guide the agent actually reads + create-time
      templates** *(S–M)* — A built-in meta-skill / scaffolded template so
      self-authored skills follow good structure (clear description, when-to-use,
      ref-file splitting). Improves the *quality* of self-improvement, not just
      the mechanics.
