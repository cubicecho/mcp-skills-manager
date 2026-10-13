import { z } from 'zod';
import { DEFAULT_PORT } from './defaults.ts';

/**
 * How skills are advertised as MCP tools.
 *
 * @remarks
 * `per-skill` serves one no-arg tool per skill, so every skill's name and description loads into the client's
 * context up front. `loader` serves a fixed pair, `list_skills` and `load_skill(name)`, and the model looks a name
 * up before loading it. Skills stay reachable as resources (`skill://<name>`) in both modes.
 */
export const skillToolModeSchema = z.enum(['per-skill', 'loader']);
/** One of the two ways skills are advertised as MCP tools. */
export type SkillToolMode = z.infer<typeof skillToolModeSchema>;

/**
 * The skill-authoring tools an MCP endpoint serves. `settings.disabledAuthoringTools` names the
 * ones to leave out.
 */
export const authoringToolNameSchema = z.enum([
  'create_skill',
  'update_skill',
  'edit_skill',
  'rename_skill',
  'delete_skill',
  'write_skill_file',
  'read_skill_file',
  'create_skill_folder',
  'move_skill_file',
  'delete_skill_file',
]);
/** The name of one skill-authoring tool. */
export type AuthoringToolName = z.infer<typeof authoringToolNameSchema>;

/**
 * Schema for DATA_DIR/config/settings.json. Hand-editable; parsing is lenient
 * on unknown keys so user additions survive round-trips.
 */
export const settingsFileSchema = z
  .object({
    /** HTTP port. Env PORT wins over this. */
    port: z.number().int().positive().default(DEFAULT_PORT),
    /**
     * Bearer token for the management API and MCP endpoints. Env MCP_SKILLS_TOKEN wins.
     * Generated on first run when auth is enabled and no token exists.
     */
    authToken: z.string().nullable().default(null),
    /** Disable to allow unauthenticated access (trusted networks only). */
    authEnabled: z.boolean().default(true),
    /**
     * Whether agents may author and update skills over MCP (the create_skill, update_skill,
     * write_skill_file, … tools); false makes every MCP endpoint read-only. Writes stay behind the same bearer
     * auth as the rest of `/mcp`.
     */
    authoringEnabled: z.boolean().default(true),
    /**
     * Authoring tools left out of every MCP endpoint while authoring is enabled, by name (see
     * authoringToolNameSchema). A name that is not an authoring tool is ignored, so a typo in a
     * hand-edited file never stops the settings from loading.
     */
    disabledAuthoringTools: z.array(z.string()).default([]),
    /** Default for how skills are advertised as MCP tools; a workspace may override it. See skillToolModeSchema. */
    skillToolMode: skillToolModeSchema.default('per-skill'),
    /**
     * Serves the HTTP `/mcp` endpoints in stateful mode, so the server can push resource updates
     * (`notifications/resources/list_changed`, `resources/updated`) to connected clients over SSE. Stateful mode
     * keeps a session and its `Mcp-Session-Id` alive per client, so it pays off only when a client subscribes
     * instead of re-polling. When false, `/mcp` is stateless: a fresh server per request and no push.
     */
    httpLiveUpdates: z.boolean().default(false),
  })
  .passthrough();

/** The parsed contents of settings.json, defaults filled in. */
export type SettingsFile = z.infer<typeof settingsFileSchema>;

/**
 * The subset of settings safe to expose over the management API — everything
 * except the bearer token. Returned by GET /api/settings.
 */
export const settingsViewSchema = settingsFileSchema
  .pick({
    authEnabled: true,
    authoringEnabled: true,
    disabledAuthoringTools: true,
    skillToolMode: true,
    httpLiveUpdates: true,
  })
  .strip();
/** The settings GET /api/settings returns: no bearer token. */
export type SettingsView = z.infer<typeof settingsViewSchema>;

/**
 * Fields an operator may change via PATCH /api/settings (auth/token are managed out of band).
 * Written out rather than derived from the file schema: a `partial()` of it would fill an absent
 * key with the file's default, and a patch must leave what it does not name alone.
 */
export const updateSettingsRequestSchema = z
  .object({
    authoringEnabled: z.boolean().optional(),
    disabledAuthoringTools: z.array(authoringToolNameSchema).optional(),
    skillToolMode: skillToolModeSchema.optional(),
    httpLiveUpdates: z.boolean().optional(),
  })
  .strict();
/** What PATCH /api/settings accepts. */
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
