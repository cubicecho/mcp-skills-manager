import type { Skill } from '@mcp-skills/shared';

/**
 * Tell whether a skill carries at least one of the wanted tags.
 * @param skill - The skill to test.
 * @param wantTags - Lower-cased tags; none means every skill matches.
 * @returns True when the skill passes the tag filter.
 */
function matchesTags(skill: Skill, wantTags: string[]): boolean {
  if (wantTags.length === 0) {
    return true;
  }
  const skillTags = skill.tags.map((t) => t.toLowerCase());
  return wantTags.some((t) => skillTags.includes(t));
}

/**
 * Tell whether every search term appears in a skill's name, description, tags or body.
 * @param skill - The skill to test.
 * @param terms - Lower-cased search terms; none means every skill matches.
 * @returns True when the skill passes the text query.
 */
function matchesTerms(skill: Skill, terms: string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const haystack = `${skill.name}\n${skill.description}\n${skill.tags.join(' ')}\n${skill.body}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * Rank skills against a free-text query and/or a tag filter. `query` is matched
 * case-insensitively against the name, description, tags, and body (each search
 * term must appear somewhere); `tags` narrows to skills carrying at least one of
 * the requested tags. With neither, every skill matches (mirrors `list_skills`).
 * Matches keep the caller's order — the metadata each carries lets the agent rank.
 */
export function searchSkills(skills: Skill[], query: string, tags: string[]): Skill[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const wantTags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  return skills.filter((skill) => matchesTags(skill, wantTags) && matchesTerms(skill, terms));
}
