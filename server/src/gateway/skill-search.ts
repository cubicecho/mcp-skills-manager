import type { Skill } from '@mcp-skills/shared';

/**
 * Tells whether a skill carries at least one of the wanted tags.
 *
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
 * Tells whether every search term appears in a skill's name, description, tags or body.
 *
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
 * Filters skills by a free-text query and a tag filter.
 *
 * @param skills - The skills to search.
 * @param query - Whitespace-separated terms, each of which must appear in the name, description, tags or body.
 * @param tags - Keeps only the skills carrying at least one of these; empty keeps them all.
 * @returns The matches, in the caller's order; every skill when there is neither a term nor a tag.
 *
 * @remarks
 * Matching ignores case. Nothing is ranked: the metadata each match carries lets the agent do that.
 */
export function searchSkills(skills: Skill[], query: string, tags: string[]): Skill[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const wantTags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  return skills.filter((skill) => matchesTags(skill, wantTags) && matchesTerms(skill, terms));
}
