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
  return { frontmatter: readFrontmatter(parsed), body: raw.slice(match[0].length) };
}

/**
 * Validate parsed frontmatter, giving up only the keys that are wrong. One mistyped value must not
 * take `readonly` or `global` down with it, nor erase the other keys on the next save.
 * @param parsed - The YAML value of the frontmatter block.
 * @returns The frontmatter without its mistyped keys; empty when the block is not a mapping.
 */
function readFrontmatter(parsed: unknown): SkillFrontmatter {
  const whole = skillFrontmatterSchema.safeParse(parsed);
  if (whole.success) {
    return whole.data;
  }
  const isMapping = typeof parsed === 'object' && parsed !== null && Array.isArray(parsed) === false;
  if (isMapping === false) {
    return {};
  }
  const mistyped = new Set(whole.error.issues.map((issue) => issue.path[0]));
  const kept = Object.entries(parsed as Record<string, unknown>).filter(([key]) => mistyped.has(key) === false);
  const rest = skillFrontmatterSchema.safeParse(Object.fromEntries(kept));
  return rest.success ? rest.data : {};
}

/**
 * Serializes frontmatter and a body back into a Markdown document.
 *
 * @param frontmatter - The keys to write, in the order given; an `undefined` value is left out.
 * @param body - The Markdown under the frontmatter; surrounding blank space is trimmed.
 * @returns The document, ending in one newline; no frontmatter block when no key is left.
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

/**
 * Write a skill's local-only settings the way frontmatter keeps them: only the non-default value
 * is stored, so the key is dropped when the skill is global, or writable.
 * @param flags - Whether the skill is served on the root endpoint, and whether agents may edit it.
 * @returns The `global` and `readonly` frontmatter keys.
 */
export function localFlags(flags: {
  global: boolean;
  readOnly: boolean;
}): Pick<SkillFrontmatter, 'global' | 'readonly'> {
  return { global: flags.global ? undefined : false, readonly: flags.readOnly ? true : undefined };
}
