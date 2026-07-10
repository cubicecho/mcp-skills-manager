import { z } from 'zod';
import { skillToolModeSchema } from './settings.ts';
import { skillNameSchema } from './skill.ts';

/**
 * A workspace is a named group of skills, exposed as its own filtered MCP
 * endpoint at /mcp/w/<slug> (and selectable over stdio with `--workspace <slug>`).
 * Workspaces are the skills-manager analog of mcp-router's projects. Config lives
 * in hand-editable JSON under DATA_DIR/config/workspaces/<slug>.json.
 */

/** A workspace slug doubles as its route segment (/mcp/w/<slug>) and config filename. */
export const workspaceSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase alphanumerics, dots, dashes, underscores; must start alphanumeric');

export const workspaceConfigSchema = z
  .object({
    /** Human-facing display name. */
    name: z.string().min(1).max(100),
    /** URL slug — the route segment at /mcp/w/<slug>, also the config filename. */
    slug: workspaceSlugSchema,
    /** Disable to 404 the workspace's endpoint without deleting it. */
    enabled: z.boolean().default(true),
    description: z.string().optional(),
    /** Skill names included in this workspace. Skills that no longer exist are ignored at serve time. */
    skills: z.array(skillNameSchema).default([]),
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

/** Derive a URL slug (a valid workspaceSlugSchema value) from a display name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-') // non-slug chars → single dash
    .replace(/^[^a-z0-9]+/, '') // must start alphanumeric
    .replace(/[-.]+$/, '') // no trailing dash/dot
    .slice(0, 64);
}
