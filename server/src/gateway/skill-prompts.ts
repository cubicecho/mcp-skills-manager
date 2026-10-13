import type { PromptArgument, Skill } from '@mcp-skills/shared';
import { promptFrontmatterSchema, promptNameSchema, SKILL_PROMPTS_DIR } from '@mcp-skills/shared';
import { parseMarkdown } from '../skills/markdown.ts';
import { byName } from '../skills/skill-name.ts';
import { bundledFiles } from '../skills/skill-view.ts';

/**
 * Skill prompts: each `prompts/<name>.md` in a `dir` skill is served as the MCP
 * prompt `<name>`. This module is the pure part — which files are prompts, what
 * each is called, and how a body is filled in — so the server only adds I/O.
 */

/** Extension a prompt file must have. */
const PROMPT_EXTENSION = '.md';

/** Joins a skill name to a prompt name when the bare prompt name is already taken. */
const QUALIFIED_NAME_SEPARATOR = '__';

/** `{{name}}` in a prompt body, with optional spaces inside the braces. */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*\}\}/g;

/** A prompt file found on a served skill, before its contents are read. */
export interface SkillPromptRef {
  /** The name the prompt is served under. */
  name: string;
  /** The skill the prompt file belongs to. */
  skillName: string;
  /** The prompt file's path, relative to the skill directory. */
  path: string;
}

/** A prompt file's contents, split into what it declares and what it says. */
export interface ParsedPrompt {
  /** What the frontmatter says the prompt is for; absent when it says nothing. */
  description?: string;
  /** The arguments the frontmatter declares. */
  arguments: PromptArgument[];
  /** The prompt text, trimmed, with its placeholders not yet filled. */
  body: string;
}

/**
 * Reads the prompt name out of a skill file's path.
 *
 * @param filePath - A path relative to the skill directory.
 * @returns The file name without `.md`; `undefined` unless the file sits directly in `prompts/` under a valid name.
 */
export function promptFileName(filePath: string): string | undefined {
  const dirPrefix = `${SKILL_PROMPTS_DIR}/`;
  const isMarkdownInPromptsDir = filePath.startsWith(dirPrefix) && filePath.endsWith(PROMPT_EXTENSION);
  if (isMarkdownInPromptsDir === false) {
    return undefined;
  }
  const stem = filePath.slice(dirPrefix.length, -PROMPT_EXTENSION.length);
  // A stem holding "/" is a file in a sub-folder, which the name pattern rejects along with the rest.
  return promptNameSchema.safeParse(stem).success ? stem : undefined;
}

/**
 * Lists the prompts a set of skills serves, each under a unique name.
 *
 * @param skills - The skills an endpoint serves.
 * @returns One entry per prompt served, in skill-name order.
 *
 * @remarks
 * A prompt is served under its bare file name. When two skills have a prompt of the same name,
 * the first skill by sorted name keeps the bare name and each later one is served as
 * `<skill>__<name>`.
 */
export function listPromptRefs(skills: Skill[]): SkillPromptRef[] {
  const sorted = [...skills].sort(byName);
  const refs = new Map<string, SkillPromptRef>();
  for (const skill of sorted) {
    for (const file of bundledFiles(skill)) {
      const fileName = promptFileName(file.path);
      if (fileName === undefined) {
        continue;
      }
      const name = refs.has(fileName) ? `${skill.name}${QUALIFIED_NAME_SEPARATOR}${fileName}` : fileName;
      // A qualified name can only be taken by a bare prompt spelled the same way; the earlier one wins.
      if (refs.has(name) === false) {
        refs.set(name, { name, skillName: skill.name, path: file.path });
      }
    }
  }
  return [...refs.values()];
}

/**
 * Splits a prompt file into its declared metadata and its body.
 *
 * @param raw - The file's full text.
 * @returns The description and arguments from the frontmatter, and the trimmed body.
 *
 * @remarks
 * Frontmatter that does not fit the prompt schema is read as declaring nothing.
 */
export function parsePrompt(raw: string): ParsedPrompt {
  const { frontmatter, body } = parseMarkdown(raw);
  const declared = promptFrontmatterSchema.safeParse(frontmatter);
  const meta = declared.success ? declared.data : { arguments: [] };
  return { ...meta, body: body.trim() };
}

/**
 * Names the required arguments a caller left out.
 *
 * @param declared - The arguments the prompt declares.
 * @param given - The argument values the caller sent.
 * @returns The names of the required arguments with no value, in declared order.
 */
export function missingArguments(declared: PromptArgument[], given: Record<string, string>): string[] {
  return declared.filter((arg) => arg.required && given[arg.name] === undefined).map((arg) => arg.name);
}

/**
 * Substitutes a prompt body's `{{name}}` placeholders.
 *
 * @param body - The prompt body.
 * @param declared - The arguments the prompt declares.
 * @param given - The argument values the caller sent.
 * @returns The filled body, trimmed.
 *
 * @remarks
 * A declared argument's placeholder becomes its value, or an empty string when it was left out. A placeholder
 * naming no declared argument is kept as written.
 */
export function fillPrompt(body: string, declared: PromptArgument[], given: Record<string, string>): string {
  const declaredNames = new Set(declared.map((arg) => arg.name));
  const filled = body.replace(PLACEHOLDER_RE, (placeholder, name: string) =>
    declaredNames.has(name) ? (given[name] ?? '') : placeholder,
  );
  return filled.trim();
}
