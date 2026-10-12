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
