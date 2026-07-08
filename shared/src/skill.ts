import { z } from 'zod';

/**
 * Schemas describing a skill: a Markdown document (with optional YAML
 * frontmatter) that an agent can load over MCP. Skills live as hand-editable
 * files under DATA_DIR/skills — either a flat `<name>.md` or a Claude-style
 * `<name>/SKILL.md` directory that may carry supporting files alongside it.
 */

/** A skill name doubles as its id, route filter value, tool/resource name and filename stem. */
export const skillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase alphanumerics, dots, dashes, underscores; must start alphanumeric');

/**
 * On-disk layout of a skill:
 * - `file`: a single `skills/<name>.md`
 * - `dir`:  a `skills/<name>/SKILL.md` directory (can hold supporting files)
 */
export const skillFormatSchema = z.enum(['file', 'dir']);
export type SkillFormat = z.infer<typeof skillFormatSchema>;

/**
 * Recognised frontmatter keys. Unknown keys are preserved (passthrough) so a
 * hand-authored skill's extra metadata survives a round-trip through the UI.
 */
export const skillFrontmatterSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    /**
     * Whether the skill is served on the root `/mcp` aggregate. Absent or `true`
     * → global (the default; every hand-authored skill stays visible). Set to
     * `false` to hide it from root while still serving it on any profile that
     * lists it — this is how agent-authored, profile-scoped skills stay
     * private to their profile.
     */
    global: z.boolean().optional(),
    /**
     * Standard Agent Skills metadata (agentskills.io spec), surfaced to agents
     * in the `list_skills` catalogue and the loaded-skill footer. Typed here so
     * they round-trip cleanly; still optional and otherwise free-form.
     */
    license: z.string().optional(),
    /** Tools the skill expects/permits — a comma-separated string or a list, per the spec. */
    'allowed-tools': z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough();
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

/** An entry (file or sub-directory) bundled next to a `dir`-format skill's SKILL.md. */
export const skillFileSchema = z.object({
  /** Path relative to the skill directory, e.g. "scripts/run.py" or "scripts". */
  path: z.string(),
  /** Whether this entry is a regular file or a sub-directory. */
  type: z.enum(['file', 'dir']).default('file'),
  /** Byte size on disk (0 for directories). */
  size: z.number().int().nonnegative(),
});
export type SkillFile = z.infer<typeof skillFileSchema>;

/** The canonical in-memory representation of a loaded skill. */
export const skillSchema = z.object({
  /** Id / filename stem / route filter value. */
  name: skillNameSchema,
  /** One-line summary from frontmatter; surfaced as the MCP tool/resource description. */
  description: z.string().default(''),
  /** Markdown body with the frontmatter block stripped. */
  body: z.string(),
  /** Full parsed frontmatter (including unknown keys). */
  frontmatter: skillFrontmatterSchema.default({}),
  format: skillFormatSchema,
  /** Whether the skill is served on the root `/mcp` aggregate (frontmatter `global`, default true). */
  global: z.boolean().default(true),
  /** File path relative to the skills dir (`<name>.md` or `<name>/SKILL.md`). */
  path: z.string(),
  /** Last-modified time of the skill's SKILL.md / `.md`, ISO 8601. */
  updatedAt: z.string(),
  /** Supporting files for a `dir` skill (empty for `file` skills). */
  files: z.array(skillFileSchema).default([]),
});
export type Skill = z.infer<typeof skillSchema>;

/** Derive a URL/route-safe skill name from a free-form title. */
export function slugifySkillName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-') // non-slug chars → single dash
    .replace(/^[^a-z0-9]+/, '') // must start alphanumeric
    .replace(/[-.]+$/, '') // no trailing dash/dot
    .slice(0, 64);
}
