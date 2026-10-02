import { z } from 'zod';
import { skillToolModeSchema } from './settings.ts';
import { slugSchema } from './slug.ts';

/**
 * A workspace is a named group of skills, exposed as its own filtered MCP
 * endpoint at /mcp/w/<slug> (and selectable over stdio with `--workspace <slug>`).
 * Workspaces are the skills-manager analog of mcp-router's projects. Config lives
 * in hand-editable JSON under DATA_DIR/config/workspaces/<slug>.json.
 */

/** One workspace config file, DATA_DIR/config/workspaces/<slug>.json. */
export const workspaceConfigSchema = z
  .object({
    /** Human-facing display name. */
    name: z.string().min(1).max(100),
    /** URL slug — the route segment at /mcp/w/<slug>, also the config filename. */
    slug: slugSchema,
    /** Disable to 404 the workspace's endpoint without deleting it. */
    enabled: z.boolean().default(true),
    description: z.string().optional(),
    /** Skill names included in this workspace. Skills that no longer exist are ignored at serve time. */
    skills: z.array(slugSchema).default([]),
    /**
     * Override how this workspace's endpoint advertises skills as tools. Omitted
     * → inherit the global `settings.skillToolMode`. Lets a large workspace opt
     * into the lean `loader` surface (or a small one force `per-skill`)
     * independently of the root default.
     */
    skillToolMode: skillToolModeSchema.optional(),
  })
  .passthrough();

export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
