import { z } from 'zod';

/**
 * How skills are advertised as MCP tools.
 * - `per-skill` (default): one no-arg tool per skill. Maximally discoverable —
 *   each skill self-advertises through `tools/list` — but every skill's name +
 *   description loads into the client's context upfront, so a large catalogue
 *   bloats the tool list.
 * - `loader`: a single `load_skill(name)` tool. The tool footprint stays fixed
 *   (`list_skills` + `load_skill`) no matter how many skills exist — leaner
 *   context, at the cost of the model consulting `list_skills` to discover
 *   names before loading. Skills remain reachable as resources (`skill://<name>`)
 *   under both modes.
 */
export const skillToolModeSchema = z.enum(['per-skill', 'loader']);
export type SkillToolMode = z.infer<typeof skillToolModeSchema>;

/**
 * Schema for DATA_DIR/config/settings.json. Hand-editable; parsing is lenient
 * on unknown keys so user additions survive round-trips.
 */
export const settingsFileSchema = z
  .object({
    /** HTTP port. Env PORT wins over this. */
    port: z.number().int().positive().default(3000),
    /** Bearer token for the management API and MCP endpoints. Env MCP_SKILLS_TOKEN wins.
     *  Generated on first run when auth is enabled and no token exists. */
    authToken: z.string().nullable().default(null),
    /** Disable to allow unauthenticated access (trusted networks only). */
    authEnabled: z.boolean().default(true),
    /**
     * Whether agents may author/update skills over MCP (the create_skill,
     * update_skill, write_skill_file, … tools). Enabled by default; set to
     * false to make every MCP endpoint read-only. Writes are always still
     * behind the same bearer auth as the rest of `/mcp`.
     */
    authoringEnabled: z.boolean().default(true),
    /** Default for how skills are advertised as MCP tools; a workspace may override it. See skillToolModeSchema. */
    skillToolMode: skillToolModeSchema.default('per-skill'),
    /**
     * Serve the HTTP `/mcp` endpoints in **stateful** mode so the server can push
     * live resource updates (`notifications/resources/list_changed` and
     * `resources/updated`) to connected clients over SSE — the HTTP analog of the
     * stdio live-updates already on by default there. Off by default: stateful
     * mode keeps a session (and its `Mcp-Session-Id`) alive per client, so only
     * enable it when a client actually subscribes instead of re-polling. When off,
     * `/mcp` stays stateless (a fresh server per request, no push).
     */
    httpLiveUpdates: z.boolean().default(false),
  })
  .passthrough();

export type SettingsFile = z.infer<typeof settingsFileSchema>;

/**
 * The subset of settings safe to expose over the management API — everything
 * except the bearer token. Returned by GET /api/settings.
 */
export const settingsViewSchema = z.object({
  authEnabled: z.boolean(),
  authoringEnabled: z.boolean(),
  skillToolMode: skillToolModeSchema,
  httpLiveUpdates: z.boolean(),
});
export type SettingsView = z.infer<typeof settingsViewSchema>;

/** Fields an operator may change via PATCH /api/settings (auth/token are managed out of band). */
export const updateSettingsRequestSchema = z
  .object({
    authoringEnabled: z.boolean().optional(),
    skillToolMode: skillToolModeSchema.optional(),
    httpLiveUpdates: z.boolean().optional(),
  })
  .strict();
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
