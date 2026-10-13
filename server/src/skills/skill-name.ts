import { slugify } from '@mcp-skills/shared';

/**
 * Picks the name a new skill gets: the explicit name, else a slug of the title.
 *
 * @param name - Explicit slug, when the caller gave one; an empty one yields no name, whatever the title.
 * @param title - Free-form title to slugify when no name is given.
 * @returns The name, or `undefined` when neither input yields one.
 *
 * @remarks
 * A title that slugifies to nothing yields none. A slugified title is a valid slug; an explicit name comes back
 * as given, so validate it at the boundary.
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
 * Orders two named things by name.
 *
 * @param a - The first.
 * @param b - The second.
 * @returns Negative, zero or positive, as `Array.prototype.sort` wants.
 *
 * @remarks
 * This is the one order skills are listed and loaded in, and so the order that decides which of two skills keeps
 * a shared tool or prompt name.
 */
export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}
