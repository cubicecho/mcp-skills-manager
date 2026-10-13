import type { Skill, SkillToolMode } from '@mcp-skills/shared';
import { normalizeTags } from '@mcp-skills/shared';
import { bundledFiles } from '../skills/skill-view.ts';
import { fileResourceUri } from './resource-uri.ts';
import { promptFileName } from './skill-prompts.ts';

/**
 * Reads the `allowed-tools` frontmatter, which is a comma-separated string or a list.
 *
 * @param skill - The skill whose frontmatter to read.
 * @returns The tool names, cleaned as tags are; empty when the key is absent or another type.
 */
function allowedTools(skill: Skill): string[] {
  return normalizeTags(skill.frontmatter['allowed-tools']);
}

/**
 * Reads the optional Agent Skills metadata an agent may care about: the license and the allowed tools.
 *
 * @param skill - The skill whose frontmatter to read.
 * @returns Each of the two that the skill declares; a key it does not declare is absent.
 */
function skillMeta(skill: Skill): { license?: string; allowedTools?: string[] } {
  const meta: { license?: string; allowedTools?: string[] } = {};
  const license = skill.frontmatter.license;
  const hasLicense = typeof license === 'string' && license.length > 0;
  if (hasLicense) {
    meta.license = license;
  }
  const tools = allowedTools(skill);
  if (tools.length > 0) {
    meta.allowedTools = tools;
  }
  return meta;
}

/**
 * Reads a skill's display title from its frontmatter `title`.
 *
 * @param skill - The skill whose frontmatter to read.
 * @returns The trimmed title, or `undefined` when the author set none; it is never made up from the slug.
 */
export function skillTitle(skill: Skill): string | undefined {
  const title = skill.frontmatter.title;
  const hasTitle = typeof title === 'string' && title.trim().length > 0;
  return hasTitle ? title.trim() : undefined;
}

/**
 * Renders the text handed to an agent when it loads a skill.
 *
 * @param skill - The skill to render.
 * @returns The Markdown body, then a footer for its metadata and one for its bundled files, prompt files left out.
 */
export function renderSkill(skill: Skill): string {
  const sections = [skill.body];

  const meta = skillMeta(skill);
  const metaLines: string[] = [];
  if (meta.allowedTools) {
    metaLines.push(`- Allowed tools: ${meta.allowedTools.join(', ')}`);
  }
  if (meta.license) {
    metaLines.push(`- License: ${meta.license}`);
  }
  if (metaLines.length > 0) {
    sections.push(`---\nSkill metadata:\n${metaLines.join('\n')}`);
  }

  // A prompt file starts the skill from a slash command; it is not reading for an agent that has loaded it.
  const files = bundledFiles(skill).filter((file) => promptFileName(file.path) === undefined);
  if (files.length > 0) {
    const list = files.map((f) => `- ${f.path} — resource \`${fileResourceUri(skill.name, f.path)}\``).join('\n');
    sections.push(
      `---\nBundled supporting files (in the skill directory \`${skill.name}/\`), readable as MCP resources:\n${list}`,
    );
  }

  // Single section ⇒ exactly `skill.body`; multiple ⇒ body + footers joined.
  return sections.join('\n\n');
}

/** The characters of an ISO timestamp that are its date. */
const DATE_CHARS = '2026-01-01'.length;

/**
 * Renders one catalogue line: the metadata an agent needs to decide whether to load a skill, never the body.
 *
 * @param skill - The skill the line is for.
 * @param mode - How the endpoint advertises skills; a per-skill tool name is only shown under `per-skill`.
 * @param toolNames - Tool name by skill name, for every skill the endpoint serves.
 * @returns The line, as `name [#tags] (notes): description`.
 */
function indexLine(skill: Skill, mode: SkillToolMode, toolNames: ReadonlyMap<string, string>): string {
  const tags = skill.tags.length > 0 ? ` [${skill.tags.map((tag) => `#${tag}`).join(' ')}]` : '';
  const toolName = toolNames.get(skill.name) ?? skill.name;
  const loadsUnderAnotherName = mode === 'per-skill' && toolName !== skill.name;
  // Flagged so an agent knows up front that the authoring tools will refuse this skill — because a
  // human marked it read-only, or because its content is owned by a git source.
  const authoringIsRefused = skill.readOnly || skill.source !== undefined;
  const files = bundledFiles(skill).map((file) => file.path);
  const meta = skillMeta(skill);
  const notes = [
    ...(loadsUnderAnotherName ? [`tool ${toolName}`] : []),
    ...(authoringIsRefused ? ['read-only'] : []),
    ...(files.length > 0 ? [`files: ${files.join(', ')}`] : []),
    ...(meta.allowedTools ? [`allowed tools: ${meta.allowedTools.join(', ')}`] : []),
    ...(meta.license ? [`license ${meta.license}`] : []),
    `changed ${skill.updatedAt.slice(0, DATE_CHARS)}`,
  ];
  const description = skill.description ? `: ${skill.description.trim().replace(/\s+/g, ' ')}` : '';
  return `${skill.name}${tags} (${notes.join('; ')})${description}`;
}

/**
 * Renders the catalogue the index and search tools answer with: a line that counts the skills, then one per skill.
 *
 * @param skills - The skills to list.
 * @param mode - How the endpoint advertises skills; a per-skill tool name is only shown under `per-skill`.
 * @param toolNames - Tool name by skill name, for every skill the endpoint serves.
 * @returns The catalogue text, with no skill bodies; `No skills.` for an empty list.
 *
 * @remarks
 * It is text rather than JSON, since an agent pays for every character of it.
 */
export function renderIndex(skills: Skill[], mode: SkillToolMode, toolNames: ReadonlyMap<string, string>): string {
  if (skills.length === 0) {
    return 'No skills.';
  }
  return [`skills: ${skills.length}`, ...skills.map((skill) => indexLine(skill, mode, toolNames))].join('\n');
}
