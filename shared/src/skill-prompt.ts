import { z } from 'zod';

/**
 * Schemas describing a skill prompt: a Markdown file under a `dir` skill's
 * `prompts/` folder, served as an MCP prompt so a client can start the skill
 * from a slash command. Its optional YAML frontmatter declares what the prompt
 * is for and which arguments its body takes.
 */

/** Folder inside a `dir` skill whose Markdown files are served as MCP prompts. */
export const SKILL_PROMPTS_DIR = 'prompts';

/** A prompt's name, and an argument's: what `{{name}}` in a prompt body may spell. */
export const promptNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'letters, digits, dashes, underscores; must start alphanumeric');

/** One argument a prompt takes, substituted for `{{name}}` in its body. */
export const promptArgumentSchema = z.object({
  name: promptNameSchema,
  /** Shown to the person filling the argument in. */
  description: z.string().optional(),
  /** A required argument must be given; an optional one left out becomes an empty string. */
  required: z.boolean().default(false),
});
export type PromptArgument = z.infer<typeof promptArgumentSchema>;

/** Recognised frontmatter keys of a prompt file. */
export const promptFrontmatterSchema = z.object({
  /** One line saying what the prompt starts; shown in the client's prompt list. */
  description: z.string().optional(),
  arguments: z.array(promptArgumentSchema).default([]),
});
export type PromptFrontmatter = z.infer<typeof promptFrontmatterSchema>;
