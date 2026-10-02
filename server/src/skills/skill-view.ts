import type { Skill, SkillFile } from '@mcp-skills/shared';

/**
 * Derives the MCP tool name a skill is served under. Tool names are conventionally `[A-Za-z0-9_-]`, but a skill
 * name may contain dots, so every other character becomes `_`.
 * @param name Skill slug.
 * @returns The sanitized tool name; distinct slugs can collide (`a.b` and `a_b`).
 */
export function skillToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Lists the regular files bundled with a skill, leaving its sub-directories out.
 * @param skill Skill whose supporting entries to filter.
 * @returns The file entries, in the skill's own order.
 */
export function bundledFiles(skill: Skill): SkillFile[] {
  return skill.files.filter((file) => file.type === 'file');
}
