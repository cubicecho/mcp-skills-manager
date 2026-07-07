import type { SkillFrontmatter } from '@mcp-skills/shared';
import { skillFrontmatterSchema } from '@mcp-skills/shared';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/**
 * Minimal Markdown-with-YAML-frontmatter (de)serialization for skill files.
 * A frontmatter block is a leading `---` line, the YAML body, and a closing
 * `---` line; everything after is the Markdown body.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ParsedMarkdown {
  frontmatter: SkillFrontmatter;
  body: string;
}

/** Split a raw Markdown document into its frontmatter and body. */
export function parseMarkdown(raw: string): ParsedMarkdown {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? '') ?? {};
  } catch {
    // Malformed frontmatter: treat the whole document as body rather than losing content.
    return { frontmatter: {}, body: raw };
  }
  const frontmatter = skillFrontmatterSchema.safeParse(parsed);
  const body = raw.slice(match[0].length);
  return { frontmatter: frontmatter.success ? frontmatter.data : {}, body };
}

/**
 * Serialize frontmatter + body back into a Markdown document. `name` and
 * `description` are written first (merged over any preserved unknown keys) so
 * the file round-trips losslessly. An entirely empty frontmatter is omitted.
 */
export function serializeMarkdown(frontmatter: SkillFrontmatter, body: string): string {
  const entries = Object.entries(frontmatter).filter(([, value]) => value !== undefined);
  const normalizedBody = body.replace(/^\s+/, '').replace(/\s*$/, '');
  if (entries.length === 0) {
    return normalizedBody.length > 0 ? `${normalizedBody}\n` : '';
  }
  const yaml = stringifyYaml(Object.fromEntries(entries)).trimEnd();
  return `---\n${yaml}\n---\n\n${normalizedBody}\n`;
}
