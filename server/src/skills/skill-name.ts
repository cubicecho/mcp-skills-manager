import { slugify } from '@mcp-skills/shared';

/**
 * Picks the name a new skill gets: the explicit name, else a slug of the title.
 * @param name Explicit slug, when the caller gave one.
 * @param title Free-form title to slugify when there is no name.
 * @returns The name, or undefined when neither input yields one (no name, and no title or a title with no letter or
 *   digit). A slugified title is a valid slug; an explicit name comes back as given, so validate it at the boundary.
 */
export function resolveSkillName(name: string | undefined, title: string | undefined): string | undefined {
  if (name !== undefined) {
    return name || undefined;
  }
  if (!title) {
    return undefined;
  }
  return slugify(title) || undefined;
}

/**
 * Order two named things by name: the one order skills are listed and loaded in, and so the order
 * that decides which of two skills keeps a shared tool or prompt name.
 * @param a - The first.
 * @param b - The second.
 * @returns Negative, zero or positive, as `Array.prototype.sort` wants.
 */
export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}
