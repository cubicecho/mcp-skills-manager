import type { AuthoringToolName, Skill } from '@mcp-skills/shared';
import { fileEncodingSchema, HttpStatus, skillFormatSchema, skillRelPathSchema, slugSchema } from '@mcp-skills/shared';
import { z } from 'zod';
import type { ConfigStore } from '../config/store.ts';
import { errorDetailMessage, HttpError } from '../errors.ts';
import { applyReplacements, type Replacement } from '../skills/replacements.ts';
import { resolveSkillName } from '../skills/skill-name.ts';
import { bundledFiles, skillToolName, skillToolNames } from '../skills/skill-view.ts';

/**
 * MCP tools that let an agent author and maintain skills over the endpoint it reads them from.
 *
 * @remarks
 * Every tool delegates to the ConfigStore mutators, so validation and atomic writes are shared with the REST
 * layer. A workspace endpoint scopes a new skill to its workspace by default and reaches only the skills it
 * serves, while the root endpoint reaches them all. A read-only or git-linked skill is refused by every tool
 * that would change it, and no tool here can lift either.
 */

/** JSON Schema of a string argument. */
const JSON_STRING = { type: 'string' } as const;
/** JSON Schema of a list-of-strings argument. */
const JSON_STRING_ARRAY = { type: 'array', items: { type: 'string' } } as const;

/** One authoring tool: its advertised MCP definition plus the handler that runs it. */
export interface AuthoringTool {
  /** What `tools/list` advertises. */
  definition: {
    name: AuthoringToolName;
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties: false;
    };
  };
  /** Runs the tool on a call's raw arguments and resolves to the text it answers with. */
  run: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * One row of the authoring table: a tool's definition, its arguments, the skill it addresses, and what it does.
 *
 * @typeParam T - The tool's parsed arguments.
 */
interface ToolSpec<T> {
  /** What `tools/list` advertises. */
  definition: AuthoringTool['definition'];
  /** Schema the call's arguments are parsed with. */
  args: z.ZodType<T>;
  /** The existing skill a call addresses, and whether it only reads it; left out by a tool that addresses none. */
  target?: { skill: (input: T) => string; access: 'read' | 'write' };
  /** Does the work, once the arguments are parsed and the addressed skill is cleared. */
  run: (input: T) => Promise<string>;
}

/** What the authoring tools need from the endpoint that exposes them. */
export interface AuthoringDeps {
  /** The store every tool reads and writes through. */
  store: ConfigStore;
  /** Set when serving a workspace endpoint — new skills are scoped to this workspace. */
  workspaceSlug?: string;
}

/**
 * Joins a validation error's issues into one line an agent can read.
 *
 * @param error - The zod error to summarize.
 * @returns Each issue as `argument: message`, separated by `; `.
 */
export function issueSummary(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(arguments)'}: ${issue.message}`).join('; ');
}

/**
 * Runs a store mutation, turning its HttpError and validation failures into plain Errors with a clean message.
 *
 * @typeParam T - What the mutation resolves to.
 * @param fn - The mutation to run.
 * @returns What the mutation resolved to.
 *
 * @remarks
 * The skill-server dispatch turns a thrown Error into an `isError` tool result the authoring agent can read.
 */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(issueSummary(err));
    }
    if (err instanceof HttpError) {
      throw new Error(errorDetailMessage(err));
    }
    throw err;
  }
}

/**
 * Parses a tool's arguments with its zod schema.
 *
 * @typeParam T - The parsed arguments.
 * @param schema - What the tool takes.
 * @param args - What the caller sent.
 * @returns The parsed arguments. Throws an Error listing the issues when they do not fit.
 */
function parseArgs<T>(schema: z.ZodType<T>, args: Record<string, unknown>): T {
  const result = schema.safeParse(args);
  if (!result.success) {
    throw new Error(issueSummary(result.error));
  }
  return result.data;
}

/**
 * Says where a just-authored skill is visible (the root aggregate, a workspace or both) and how to load it.
 *
 * @param skill - The skill just authored.
 * @param workspaceSlug - The workspace whose endpoint authored it, if any.
 * @param toolName - The tool the endpoint serves the skill under.
 * @returns Two sentences: where the skill is visible, then how to load it.
 */
function whereVisible(skill: Skill, workspaceSlug: string | undefined, toolName: string): string {
  const load = `Load it by calling the tool named "${toolName}".`;
  const parts = [
    skill.global ? 'served globally on the root /mcp endpoint' : 'hidden from the root /mcp endpoint (global:false)',
  ];
  if (workspaceSlug) {
    parts.push(`included in workspace "${workspaceSlug}"`);
  }
  return `It is ${parts.join(' and ')}. ${load}`;
}

/**
 * Summarizes a skill's supporting files in one sentence.
 *
 * @param skill - The skill as it now stands.
 * @returns The sentence, which lists the files or says there are none; folders are not listed.
 */
function fileSummary(skill: Skill): string {
  const files = bundledFiles(skill);
  if (files.length === 0) {
    return 'It has no supporting files.';
  }
  return `Supporting files: ${files.map((f) => f.path).join(', ')}.`;
}

const createArgs = z.object({
  name: slugSchema.optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  body: z.string().optional(),
  format: skillFormatSchema.optional(),
  global: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
const updateArgs = z.object({
  name: z.string(),
  description: z.string().optional(),
  body: z.string().optional(),
  global: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
const editArgs = z.object({
  name: z.string(),
  path: skillRelPathSchema.optional(),
  edits: z
    .array(z.object({ old_text: z.string().min(1), new_text: z.string(), replace_all: z.boolean().optional() }))
    .min(1),
});
const renameArgs = z.object({ name: z.string(), new_name: z.string() });
const deleteArgs = z.object({ name: z.string() });
const writeFileArgs = z.object({
  skill: z.string(),
  path: skillRelPathSchema,
  content: z.string(),
  encoding: fileEncodingSchema.optional(),
});
/** Arguments of every tool that addresses one path inside a skill's folder. */
const skillPathArgs = z.object({ skill: z.string(), path: skillRelPathSchema });
const moveArgs = z.object({
  skill: z.string(),
  from: skillRelPathSchema,
  to: skillRelPathSchema,
});

/**
 * Builds the authoring tool set for an endpoint, root or a single workspace.
 *
 * @param deps - The store, and the workspace the endpoint serves when it is not the root.
 * @returns Every authoring tool; the skill server leaves out the ones the settings disable.
 */
export function buildAuthoringTools(deps: AuthoringDeps): AuthoringTool[] {
  const { store, workspaceSlug } = deps;
  const scope = workspaceSlug ? ` (scoped to workspace "${workspaceSlug}")` : '';

  /**
   * Lists what this endpoint serves: the workspace's skills, or every global skill on the root endpoint.
   *
   * @returns The served skills, read fresh.
   */
  const servedSkills = (): Skill[] => {
    if (workspaceSlug === undefined) {
      return store.getGlobalSkills();
    }
    const workspace = store.getWorkspace(workspaceSlug);
    return workspace ? store.getSkillsForWorkspace(workspace) : [];
  };

  /**
   * Names the tool this endpoint serves a skill under, which is numbered when another skill holds the bare name.
   *
   * @param skill - The skill just authored; one the endpoint does not serve gets its bare tool name.
   * @returns The tool name.
   */
  const toolNameOf = (skill: Skill): string =>
    skillToolNames(servedSkills()).get(skill.name) ?? skillToolName(skill.name);

  /**
   * Refuses, on a workspace endpoint, a skill that workspace does not serve: the endpoint authors its own set only.
   *
   * @param name - Slug the tool call addresses.
   *
   * @remarks
   * The root endpoint reaches every skill, and an unknown name falls through to the store's 404.
   */
  const requireServed = (name: string): void => {
    if (workspaceSlug === undefined || store.getSkill(name) === undefined) {
      return;
    }
    const isServed = servedSkills().some((skill) => skill.name === name);
    if (isServed === false) {
      throw new Error(
        `Skill "${name}" is not served by workspace "${workspaceSlug}", so it cannot be read or changed from this endpoint.`,
      );
    }
  };

  /**
   * Refuses a skill this endpoint does not serve, one whose content a git source owns, or one marked read-only.
   *
   * @param name - Slug the tool call addresses.
   *
   * @remarks
   * An unknown name falls through to the store's 404.
   */
  const requireWritable = (name: string): void => {
    requireServed(name);
    if (store.getSkill(name)?.source) {
      throw new Error(
        `Skill "${name}" is managed from a git source and cannot be modified, renamed or deleted over MCP. ` +
          'Only a human can sync or unlink it in the web UI — do not retry; create a new skill instead if you need a variant.',
      );
    }
    if (store.getSkill(name)?.readOnly) {
      throw new Error(
        `Skill "${name}" is read-only and cannot be modified, renamed or deleted over MCP. ` +
          'Only a human can lift this in the web UI — do not retry; create a new skill instead if you need a variant.',
      );
    }
  };

  /**
   * Swaps passages of a skill's Markdown body, leaving its frontmatter as it is.
   *
   * @param name - Slug of the skill.
   * @param replacements - The passages to swap, in order.
   * @returns How many passages were swapped.
   */
  const editBody = async (name: string, replacements: Replacement[]): Promise<number> => {
    const skill = store.requireSkill(name);
    const { text, replaced } = applyReplacements(skill.body, replacements);
    await store.updateSkill(name, { body: text });
    return replaced;
  };

  /**
   * Swaps passages of one of a skill's supporting files, keeping the CRLF line endings of a file that has them.
   *
   * @param name - Slug of the skill.
   * @param relPath - The file's path, relative to the skill directory; a binary file is refused.
   * @param replacements - The passages to swap, in order.
   * @returns How many passages were swapped.
   */
  const editSupportingFile = async (name: string, relPath: string, replacements: Replacement[]): Promise<number> => {
    const file = await store.readSupportingFile(name, relPath);
    if (file.binary) {
      throw new HttpError(
        HttpStatus.BadRequest,
        `"${relPath}" is a binary file: replace it whole with write_skill_file`,
      );
    }
    const { text, replaced } = applyReplacements(file.content, replacements);
    const stored = file.content.includes('\r\n') ? text.replaceAll('\n', '\r\n') : text;
    await store.writeSupportingFile(name, relPath, Buffer.from(stored, 'utf8'));
    return replaced;
  };

  /**
   * Turns one row of the table into a served tool.
   *
   * @typeParam T - The tool's parsed arguments.
   * @param spec - The row.
   * @returns The tool, as the skill server dispatches it.
   *
   * @remarks
   * A call's arguments are parsed, then the skill it addresses is checked for this endpoint's reach, and for
   * being writable when the tool changes it, before the row runs.
   */
  const tool = <T>(spec: ToolSpec<T>): AuthoringTool => ({
    definition: spec.definition,
    run: async (args) => {
      const input = parseArgs(spec.args, args);
      if (spec.target?.access === 'write') {
        requireWritable(spec.target.skill(input));
      }
      if (spec.target?.access === 'read') {
        requireServed(spec.target.skill(input));
      }
      return spec.run(input);
    },
  });

  return [
    tool({
      definition: {
        name: 'create_skill',
        description:
          `Author a new skill (a Markdown playbook/reference other agents can load)${scope}. ` +
          'Provide either `name` (a slug) or `title` (a slug is derived from it), plus a one-line ' +
          '`description` and the Markdown `body`. Defaults to the directory layout (`<name>/SKILL.md`) ' +
          'so you can attach supporting files later with write_skill_file. Skills authored on the root ' +
          'endpoint are global; skills authored via a workspace are scoped to it by default — pass ' +
          '`global` to override.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { ...JSON_STRING, description: 'Skill slug: lowercase alphanumerics, dots, dashes, underscores.' },
            title: {
              ...JSON_STRING,
              description: 'Free-form title; a slug is derived from it when `name` is omitted.',
            },
            description: { ...JSON_STRING, description: 'One-line summary shown in the skill catalogue.' },
            body: { ...JSON_STRING, description: 'The skill Markdown body (no frontmatter — it is generated).' },
            format: {
              type: 'string',
              enum: ['dir', 'file'],
              description: 'On-disk layout. `dir` → <name>/SKILL.md (default, supports ref files); `file` → <name>.md.',
            },
            global: {
              type: 'boolean',
              description:
                'Serve on the root /mcp aggregate. Defaults to true on the root endpoint and false ' +
                '(workspace-scoped only) on a workspace endpoint. Set true from a workspace to also serve globally.',
            },
            tags: {
              ...JSON_STRING_ARRAY,
              description: 'Optional tags/categories for organising and filtering skills.',
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
      args: createArgs,
      run: async (input) => {
        // An explicit name was checked with the arguments, and a slugified title is a slug by construction.
        const name = resolveSkillName(input.name, input.title);
        if (!name) {
          throw new Error('Provide a "name" or a "title" to create a skill');
        }
        // Default visibility follows the endpoint (global on root, scoped on a workspace); `global` overrides it.
        const global = input.global ?? !workspaceSlug;
        const skill = await guard(() =>
          store.createSkill({
            name,
            description: input.description ?? '',
            body: input.body ?? '',
            format: input.format ?? 'dir',
            global,
            tags: input.tags,
          }),
        );
        if (workspaceSlug) {
          await guard(() => store.addSkillToWorkspace(workspaceSlug, name));
        }
        return `Created skill "${skill.name}" (${skill.format}). ${whereVisible(skill, workspaceSlug, toolNameOf(skill))}`;
      },
    }),
    tool({
      definition: {
        name: 'update_skill',
        description:
          'Update an existing skill in place: replace its `description` and/or its Markdown `body`, and/or ' +
          'toggle its `global` visibility on the root /mcp endpoint. Preserves the skill format, supporting ' +
          'files and any hand-added frontmatter. To change part of the body, use edit_skill, which sends only ' +
          'the passages that change. Use rename_skill to change the slug and write_skill_file to ' +
          'change supporting files. Skills marked read-only (`readOnly` in the catalogue) cannot be changed by ' +
          'this or any other authoring tool.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { ...JSON_STRING, description: 'Slug of the skill to update.' },
            description: { ...JSON_STRING, description: 'New one-line summary (omit to keep the current one).' },
            body: { ...JSON_STRING, description: 'New full Markdown body (omit to keep the current one).' },
            global: {
              type: 'boolean',
              description:
                'Serve on the root /mcp aggregate. Set false to hide from root (workspace-scoped only), true to ' +
                'promote a scoped skill to global. Omit to leave unchanged.',
            },
            tags: {
              ...JSON_STRING_ARRAY,
              description: 'Replace the skill tags/categories (empty list clears them). Omit to leave unchanged.',
            },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
      args: updateArgs,
      target: { skill: (input) => input.name, access: 'write' },
      run: async (input) => {
        const skill = await guard(() =>
          store.updateSkill(input.name, {
            description: input.description,
            body: input.body,
            global: input.global,
            tags: input.tags,
          }),
        );
        return `Updated skill "${skill.name}". ${whereVisible(skill, workspaceSlug, toolNameOf(skill))} ${fileSummary(skill)}`;
      },
    }),
    tool({
      definition: {
        name: 'edit_skill',
        description:
          'Change part of a skill without sending the rest of it: each edit swaps one exact passage (`old_text`) ' +
          'for another (`new_text`), in the skill’s Markdown body, or in the supporting file at `path` when ' +
          'given. `old_text` must match character for character, as the skill or read_skill_file returned it, ' +
          'and be there exactly once unless `replace_all` is true, so include enough of the surrounding text to ' +
          'make it unique. Edits are made in order, each on the result of the one before, and if any of them ' +
          'does not apply nothing is written. An empty `new_text` deletes the passage. A passage that is not ' +
          'found is answered with the nearest one the text does have.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { ...JSON_STRING, description: 'Slug of the skill to edit.' },
            path: {
              ...JSON_STRING,
              description:
                'Supporting file to edit, relative to the skill directory, e.g. "reference.md". Omit to edit the skill body.',
            },
            edits: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  old_text: { ...JSON_STRING, description: 'The passage to replace, exactly as it is in the text.' },
                  new_text: { ...JSON_STRING, description: 'What replaces it; empty to delete the passage.' },
                  replace_all: {
                    type: 'boolean',
                    description: 'Replace every occurrence of old_text rather than require exactly one.',
                  },
                },
                required: ['old_text', 'new_text'],
                additionalProperties: false,
              },
            },
          },
          required: ['name', 'edits'],
          additionalProperties: false,
        },
      },
      args: editArgs,
      target: { skill: (input) => input.name, access: 'write' },
      run: async (input) => {
        const replacements = input.edits.map((edit) => ({
          oldText: edit.old_text,
          newText: edit.new_text,
          replaceAll: edit.replace_all,
        }));
        const { path: relPath } = input;
        if (relPath === undefined) {
          const replaced = await guard(() => editBody(input.name, replacements));
          return `Edited skill "${input.name}" (replaced ${replaced}).`;
        }
        const replaced = await guard(() => editSupportingFile(input.name, relPath, replacements));
        return `Edited "${relPath}" in skill "${input.name}" (replaced ${replaced}).`;
      },
    }),
    tool({
      definition: {
        name: 'rename_skill',
        description: 'Rename a skill, moving its file/directory on disk. Fails if the new slug is already taken.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { ...JSON_STRING, description: 'Current slug of the skill.' },
            new_name: { ...JSON_STRING, description: 'New slug (lowercase alphanumerics, dots, dashes, underscores).' },
          },
          required: ['name', 'new_name'],
          additionalProperties: false,
        },
      },
      args: renameArgs,
      target: { skill: (input) => input.name, access: 'write' },
      run: async (input) => {
        const target = slugSchema.safeParse(input.new_name);
        if (!target.success) {
          throw new Error(`Invalid skill name "${input.new_name}"`);
        }
        // The store points every workspace that listed the skill at its new name.
        const skill = await guard(() => store.renameSkill(input.name, target.data));
        return `Renamed skill "${input.name}" to "${skill.name}". ${whereVisible(skill, workspaceSlug, toolNameOf(skill))}`;
      },
    }),
    tool({
      definition: {
        name: 'delete_skill',
        description: 'Delete a skill and all its supporting files. This cannot be undone.',
        inputSchema: {
          type: 'object',
          properties: { name: { ...JSON_STRING, description: 'Slug of the skill to delete.' } },
          required: ['name'],
          additionalProperties: false,
        },
      },
      args: deleteArgs,
      target: { skill: (input) => input.name, access: 'write' },
      run: async (input) => {
        // The store drops the skill from every workspace that listed it.
        await guard(() => store.deleteSkill(input.name));
        return `Deleted skill "${input.name}".`;
      },
    }),
    tool({
      definition: {
        name: 'write_skill_file',
        description:
          'Add or overwrite a supporting file inside a skill (e.g. reference.md, scripts/run.py). ' +
          'To change part of a text file that is already there, use edit_skill with its `path`. Promotes a `file`-format skill to a directory automatically. Binary content must be base64-encoded.',
        inputSchema: {
          type: 'object',
          properties: {
            skill: { ...JSON_STRING, description: 'Slug of the skill to attach the file to.' },
            path: { ...JSON_STRING, description: 'Path relative to the skill directory, e.g. "scripts/run.py".' },
            content: { ...JSON_STRING, description: 'File contents (text, or base64 when encoding is base64).' },
            encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Encoding of `content`. Default utf8.' },
          },
          required: ['skill', 'path', 'content'],
          additionalProperties: false,
        },
      },
      args: writeFileArgs,
      target: { skill: (input) => input.skill, access: 'write' },
      run: async (input) => {
        const skill = await guard(() =>
          store.writeSupportingFile(input.skill, input.path, Buffer.from(input.content, input.encoding ?? 'utf8')),
        );
        return `Wrote "${input.path}" to skill "${skill.name}". ${fileSummary(skill)}`;
      },
    }),
    tool({
      definition: {
        name: 'read_skill_file',
        description:
          'Read one supporting file from a skill so you can review it before editing. Binary files come back base64-encoded.',
        inputSchema: {
          type: 'object',
          properties: {
            skill: { ...JSON_STRING, description: 'Slug of the skill.' },
            path: { ...JSON_STRING, description: 'Path relative to the skill directory.' },
          },
          required: ['skill', 'path'],
          additionalProperties: false,
        },
      },
      args: skillPathArgs,
      target: { skill: (input) => input.skill, access: 'read' },
      run: async (input) => {
        const file = await guard(() => store.readSupportingFile(input.skill, input.path));
        if (file.binary) {
          return `${input.path} (${file.size} bytes, binary, base64):\n${file.content}`;
        }
        return file.content;
      },
    }),
    tool({
      definition: {
        name: 'create_skill_folder',
        description: 'Create an empty sub-directory inside a skill (promotes a `file` skill to a directory).',
        inputSchema: {
          type: 'object',
          properties: {
            skill: { ...JSON_STRING, description: 'Slug of the skill.' },
            path: {
              ...JSON_STRING,
              description: 'Directory path relative to the skill root, e.g. "reference/examples".',
            },
          },
          required: ['skill', 'path'],
          additionalProperties: false,
        },
      },
      args: skillPathArgs,
      target: { skill: (input) => input.skill, access: 'write' },
      run: async (input) => {
        const skill = await guard(() => store.createSupportingFolder(input.skill, input.path));
        return `Created folder "${input.path}" in skill "${skill.name}".`;
      },
    }),
    tool({
      definition: {
        name: 'move_skill_file',
        description: 'Rename or move a supporting file or folder within a skill.',
        inputSchema: {
          type: 'object',
          properties: {
            skill: { ...JSON_STRING, description: 'Slug of the skill.' },
            from: { ...JSON_STRING, description: 'Existing path relative to the skill root.' },
            to: { ...JSON_STRING, description: 'New path relative to the skill root.' },
          },
          required: ['skill', 'from', 'to'],
          additionalProperties: false,
        },
      },
      args: moveArgs,
      target: { skill: (input) => input.skill, access: 'write' },
      run: async (input) => {
        const skill = await guard(() => store.moveSupportingPath(input.skill, input.from, input.to));
        return `Moved "${input.from}" to "${input.to}" in skill "${skill.name}".`;
      },
    }),
    tool({
      definition: {
        name: 'delete_skill_file',
        description: 'Delete a supporting file or folder (folders recursively) from a skill.',
        inputSchema: {
          type: 'object',
          properties: {
            skill: { ...JSON_STRING, description: 'Slug of the skill.' },
            path: { ...JSON_STRING, description: 'Path relative to the skill root.' },
          },
          required: ['skill', 'path'],
          additionalProperties: false,
        },
      },
      args: skillPathArgs,
      target: { skill: (input) => input.skill, access: 'write' },
      run: async (input) => {
        const skill = await guard(() => store.deleteSupportingFile(input.skill, input.path));
        return `Deleted "${input.path}" from skill "${skill.name}". ${fileSummary(skill)}`;
      },
    }),
  ];
}
