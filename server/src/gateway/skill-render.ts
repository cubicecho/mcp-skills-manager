import type { Skill } from '@mcp-skills/shared';
import { bundledFiles, skillToolName } from '../skills/skill-view.ts';
import { fileResourceUri } from './resource-uri.ts';
import { promptFileName } from './skill-prompts.ts';

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

/** One catalogue entry: the metadata an agent needs to decide whether to load a skill (never the body). */
function indexEntry(skill: Skill) {
  return {
    name: skill.name,
    tool: skillToolName(skill.name),
    description: skill.description,
    format: skill.format,
    files: bundledFiles(skill).map((f) => f.path),
    updatedAt: skill.updatedAt,
    ...(skill.tags.length > 0 ? { tags: skill.tags } : {}),
    // Only flagged when set, so an agent knows up front that the authoring tools will refuse this skill —
    // because a human marked it read-only, or because its content is owned by a git source.
    ...(skill.readOnly || skill.source ? { readOnly: true } : {}),
    ...skillMeta(skill),
  };
}

/** The JSON catalogue returned by the index tool: every skill's metadata, no bodies. */
export function renderIndex(skills: Skill[]): string {
  return JSON.stringify({ count: skills.length, skills: skills.map(indexEntry) }, null, 2);
}
