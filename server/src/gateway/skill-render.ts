import type { Skill, SkillToolMode } from '@mcp-skills/shared';
import { bundledFiles, skillToolName } from '../skills/skill-view.ts';
import { fileResourceUri } from './resource-uri.ts';

/** Normalize the `allowed-tools` frontmatter (a comma-separated string or a list) to a clean string array. */
function allowedTools(skill: Skill): string[] {
  const raw = skill.frontmatter['allowed-tools'];
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return parts.map((t) => t.trim()).filter((t) => t.length > 0);
}

/** The optional Agent Skills metadata (license, allowed-tools) an agent may care about, if present. */
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

/** Optional human-readable display title, from frontmatter `title` when authored (never fabricated from the slug). */
export function skillTitle(skill: Skill): string | undefined {
  const title = skill.frontmatter.title;
  const hasTitle = typeof title === 'string' && title.trim().length > 0;
  return hasTitle ? title.trim() : undefined;
}

/** The text handed to an agent when it loads a skill: the Markdown body, plus footers for metadata and bundled files. */
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

  const files = bundledFiles(skill);
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

/** One catalogue line: the metadata an agent needs to decide whether to load a skill (never the body). */
function indexLine(skill: Skill, mode: SkillToolMode): string {
  const tags = skill.tags.length > 0 ? ` [${skill.tags.map((tag) => `#${tag}`).join(' ')}]` : '';
  const toolName = skillToolName(skill.name);
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
 * The catalogue returned by the index and search tools: a line that counts the skills, then one
 * line per skill. Text rather than JSON, since an agent pays for every character of it.
 * @param skills - The skills to list.
 * @param mode - How the endpoint advertises skills; a per-skill tool name is only shown under `per-skill`.
 * @returns The catalogue text, with no skill bodies.
 */
export function renderIndex(skills: Skill[], mode: SkillToolMode): string {
  if (skills.length === 0) {
    return 'No skills.';
  }
  return [`skills: ${skills.length}`, ...skills.map((skill) => indexLine(skill, mode))].join('\n');
}
