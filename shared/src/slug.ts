import { z } from 'zod';

/** Longest slug accepted, in characters. */
export const SLUG_MAX_LENGTH = 64;

/**
 * A slug names a skill or a workspace. A skill's slug doubles as its id, tool/resource name and filename stem; a
 * workspace's as its route segment (/mcp/w/<slug>) and config filename.
 */
export const slugSchema = z
  .string()
  .min(1)
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase alphanumerics, dots, dashes, underscores; must start alphanumeric');

/**
 * Derives a slug from a free-form title or display name.
 * @param text Title or name to convert.
 * @returns A value {@link slugSchema} accepts, or an empty string when the text has no letter or digit.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-') // non-slug chars → single dash
    .replace(/^[^a-z0-9]+/, '') // must start alphanumeric
    .replace(/[-.]+$/, '') // no trailing dash/dot
    .slice(0, SLUG_MAX_LENGTH);
}
