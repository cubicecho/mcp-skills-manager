import { z } from 'zod';

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
  })
  .passthrough();

export type SettingsFile = z.infer<typeof settingsFileSchema>;
