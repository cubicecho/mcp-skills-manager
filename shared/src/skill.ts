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
  })
  .passthrough();
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

/** A supporting file bundled next to a `dir`-format skill's SKILL.md. */
export const skillFileSchema = z.object({
  /** Path relative to the skill directory, e.g. "scripts/run.py". */
  path: z.string(),
  /** Byte size on disk. */
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
