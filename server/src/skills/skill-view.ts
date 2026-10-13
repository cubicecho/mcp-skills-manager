import type { Skill, SkillFile } from '@mcp-skills/shared';
import { byName } from './skill-name.ts';

/**
 * Derives the MCP tool name a skill is served under.
 *
 * @param name - Skill slug.
 * @returns The sanitized tool name; distinct slugs can collide (`a.b` and `a_b`), which {@link skillToolNames} settles.
 *
 * @remarks
 * Tool names are conventionally `[A-Za-z0-9_-]`, but a skill name may contain dots, so every other character
 * becomes `_`.
 */
export function skillToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Joins a shared tool name to the number that tells a later skill apart, as `<tool>__<n>`. */
const TOOL_NUMBER_SEPARATOR = '__';

/** The number the first skill to be told apart from the holder of a shared tool name gets. */
const FIRST_TOOL_NUMBER = 2;

/**
 * Names the tool each skill of one endpoint is served under, so that no two skills share one.
 *
 * @param skills - Every skill the endpoint serves.
 * @returns Tool name by skill name, in sorted skill order.
 *
 * @remarks
 * A skill whose name needs no sanitizing always keeps it. Of the others that sanitize to one name, the first in
 * sorted order takes it when it is free and each later one is numbered, as `<tool>__2`, `<tool>__3`.
 */
export function skillToolNames(skills: ReadonlyArray<Pick<Skill, 'name'>>): Map<string, string> {
  const names = [...skills].sort(byName).map((skill) => skill.name);
  const taken = new Set(names.filter((name) => skillToolName(name) === name));
  const toolNames = new Map<string, string>();
  for (const name of names) {
    const base = skillToolName(name);
    let toolName = base;
    if (base !== name) {
      for (let number = FIRST_TOOL_NUMBER; taken.has(toolName); number += 1) {
        toolName = `${base}${TOOL_NUMBER_SEPARATOR}${number}`;
      }
      taken.add(toolName);
    }
    toolNames.set(name, toolName);
  }
  return toolNames;
}

/**
 * Lists the regular files bundled with a skill, leaving its sub-directories out.
 *
 * @param skill - Skill whose supporting entries to filter.
 * @returns The file entries, in the skill's own order.
 */
export function bundledFiles(skill: Skill): SkillFile[] {
  return skill.files.filter((file) => file.type === 'file');
}
