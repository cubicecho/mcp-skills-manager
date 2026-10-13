import type { SkillSummary } from '@mcp-skills/shared';

/**
 * Counts a skill's files, its own Markdown included, so a count over one always means supporting files.
 *
 * @param skill - The skill to count.
 * @returns The number of files; folders are not counted.
 */
export function skillFileCount(skill: Pick<SkillSummary, 'files'>): number {
  return skill.files.filter((file) => file.type === 'file').length + 1;
}

/**
 * Says where a skill's own Markdown is, as shown beside it.
 *
 * @param skill - The skill to locate.
 * @returns The path from the data directory.
 */
export function skillMarkdownPath(skill: Pick<SkillSummary, 'path'>): string {
  return `skills/${skill.path}`;
}

/**
 * Says where a skill's files are: its folder, or the one file of a skill that has no folder.
 *
 * @param skill - The skill to locate.
 * @returns The path from the data directory.
 *
 * @remarks
 * The folder is read from the stored path, since a folder need not be named after its skill.
 */
export function skillFilesPath(skill: Pick<SkillSummary, 'format' | 'path'>): string {
  const markdown = skillMarkdownPath(skill);
  return skill.format === 'dir' ? markdown.slice(0, markdown.lastIndexOf('/') + 1) : markdown;
}
