import type { Dirent } from 'node:fs';
import path from 'node:path';
import type { Skill } from '@mcp-skills/shared';

/** File name of a directory-format skill's primary document. */
export const SKILL_FILE = 'SKILL.md';

/** Extension of a flat-file skill. */
const FLAT_FILE_EXT = '.md';

/**
 * Finds the folder a skill occupies, relative to the skills dir.
 *
 * @param skill - The skill's stored `path` and `format`.
 * @returns The folder holding SKILL.md for a `dir` skill; the file-name stem for a `file` skill.
 *
 * @remarks
 * The stem is the folder a `file` skill would occupy once promoted to a `dir`.
 */
export function skillFolder(skill: Pick<Skill, 'path' | 'format'>): string {
  return skill.format === 'dir' ? path.dirname(skill.path) : skill.path.slice(0, -FLAT_FILE_EXT.length);
}

/**
 * Builds the path a `dir` skill loads from.
 *
 * @param folder - The skill's folder, relative to the skills dir.
 * @returns `<folder>/SKILL.md`, relative to the skills dir.
 */
export function dirSkillPath(folder: string): string {
  return path.join(folder, SKILL_FILE);
}

/**
 * Builds the path a `file` skill loads from.
 *
 * @param name - The skill's file-name stem.
 * @returns `<name>.md`, relative to the skills dir.
 */
export function fileSkillPath(name: string): string {
  return `${name}${FLAT_FILE_EXT}`;
}

/**
 * Builds the path a skill of either layout loads from.
 *
 * @param format - The skill's layout.
 * @param name - The skill's folder (`dir`) or file-name stem (`file`).
 * @returns The skill document's path, relative to the skills dir.
 */
export function skillPath(format: Skill['format'], name: string): string {
  return format === 'dir' ? dirSkillPath(name) : fileSkillPath(name);
}

/**
 * Tells whether a skills-dir entry is a flat-file skill.
 *
 * @param entry - Directory entry to test.
 * @returns True for a regular file named `*.md`.
 */
export function isMarkdownFile(entry: Dirent): boolean {
  return entry.isFile() && entry.name.endsWith(FLAT_FILE_EXT);
}
