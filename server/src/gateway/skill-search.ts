import type { Skill } from '@mcp-skills/shared';

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
  return skills.filter((skill) => {
    if (wantTags.length > 0) {
      const skillTags = skill.tags.map((t) => t.toLowerCase());
      if (!wantTags.some((t) => skillTags.includes(t))) {
        return false;
      }
    }
    if (terms.length > 0) {
      const haystack = `${skill.name}\n${skill.description}\n${skill.tags.join(' ')}\n${skill.body}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) {
        return false;
      }
    }
    return true;
  });
}
