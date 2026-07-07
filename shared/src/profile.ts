import { z } from 'zod';
import { skillNameSchema } from './skill.ts';

/**
 * A profile is a named group of skills, exposed as its own filtered MCP
 * endpoint at /mcp/p/<slug> (and selectable over stdio with `--profile <slug>`).
 * Profiles are the skills-manager analog of mcp-router's projects. Config lives
 * in hand-editable JSON under DATA_DIR/config/profiles/<slug>.json.
 */

/** A profile slug doubles as its route segment (/mcp/p/<slug>) and config filename. */
export const profileSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase alphanumerics, dots, dashes, underscores; must start alphanumeric');

export const profileConfigSchema = z
  .object({
    /** Human-facing display name. */
    name: z.string().min(1).max(100),
    /** URL slug — the route segment at /mcp/p/<slug>, also the config filename. */
    slug: profileSlugSchema,
    /** Disable to 404 the profile's endpoint without deleting it. */
    enabled: z.boolean().default(true),
    description: z.string().optional(),
    /** Skill names included in this profile. Skills that no longer exist are ignored at serve time. */
    skills: z.array(skillNameSchema).default([]),
  })
  .passthrough();

export type ProfileConfig = z.infer<typeof profileConfigSchema>;

/** Derive a URL slug (a valid profileSlugSchema value) from a display name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-') // non-slug chars → single dash
    .replace(/^[^a-z0-9]+/, '') // must start alphanumeric
    .replace(/[-.]+$/, '') // no trailing dash/dot
    .slice(0, 64);
}
