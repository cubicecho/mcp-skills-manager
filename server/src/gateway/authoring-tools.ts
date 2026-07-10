import type { Skill } from '@mcp-skills/shared';
import { skillNameSchema, slugifySkillName } from '@mcp-skills/shared';
import { z } from 'zod';
import type { ConfigStore } from '../config/store.ts';
import { errorDetailMessage, HttpError } from '../errors.ts';

/**
 * MCP tools that let an agent author and maintain skills over the same endpoint
 * it reads them from — the self-improvement surface. Every tool delegates to the
 * existing ConfigStore mutators, so validation, atomic writes, frontmatter
 * serialization and path-traversal defenses are shared with the REST layer.
 *
 * When these tools are served from a workspace endpoint (`workspaceSlug` set), a
 * newly created skill is scoped to that workspace: written with `global: false`
 * (hidden from the root `/mcp` aggregate) and appended to the workspace's member
 * list. Authored from the root endpoint, skills are global as usual.
 */

/** MCP tool-name → conventional `[A-Za-z0-9_-]` (mirrors skill-server's toolName). */
function toToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

const JSON_STRING = { type: 'string' } as const;
const JSON_STRING_ARRAY = { type: 'array', items: { type: 'string' } } as const;

/** One authoring tool: its advertised MCP definition plus the handler that runs it. */
export interface AuthoringTool {
  definition: {
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties: false;
    };
  };
  run: (args: Record<string, unknown>) => Promise<string>;
}

export interface AuthoringDeps {
  store: ConfigStore;
  /** Set when serving a workspace endpoint — new skills are scoped to this workspace. */
  workspaceSlug?: string;
}

/**
 * Run a store mutation, normalizing its HttpError/validation failures into plain
 * Errors with a clean message. The skill-server dispatch turns a thrown Error
 * into an `isError` tool result the authoring agent can read and act on.
 */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues.map((i) => i.message).join('; '));
    }
    if (err instanceof HttpError) {
      throw new Error(errorDetailMessage(err));
    }
    throw err;
  }
}

/** Parse a tool's arguments with its zod schema, surfacing failures as a readable Error. */
function parseArgs<T>(schema: z.ZodType<T>, args: Record<string, unknown>): T {
  const result = schema.safeParse(args);
  if (!result.success) {
    throw new Error(result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

/** How to load a skill after authoring it, plus where it is visible (root aggregate and/or a workspace). */
function whereVisible(skill: Skill, workspaceSlug: string | undefined): string {
  const load = `Load it by calling the tool named "${toToolName(skill.name)}".`;
  const parts = [
    skill.global ? 'served globally on the root /mcp endpoint' : 'hidden from the root /mcp endpoint (global:false)',
  ];
  if (workspaceSlug) {
    parts.push(`included in workspace "${workspaceSlug}"`);
  }
  return `It is ${parts.join(' and ')}. ${load}`;
}

/** Short human/agent-readable summary of a skill's current supporting files. */
function fileSummary(skill: Skill): string {
  const files = skill.files.filter((f) => f.type === 'file');
  if (files.length === 0) {
    return 'It has no supporting files.';
  }
  return `Supporting files: ${files.map((f) => f.path).join(', ')}.`;
}

// --- argument schemas ---

const createArgs = z.object({
  name: skillNameSchema.optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  body: z.string().optional(),
  format: z.enum(['file', 'dir']).optional(),
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
const renameArgs = z.object({ name: z.string(), new_name: z.string() });
const deleteArgs = z.object({ name: z.string() });
const writeFileArgs = z.object({
  skill: z.string(),
  path: z.string().min(1).max(255),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).optional(),
});
const readFileArgs = z.object({ skill: z.string(), path: z.string().min(1).max(255) });
const folderArgs = z.object({ skill: z.string(), path: z.string().min(1).max(255) });
const moveArgs = z.object({
  skill: z.string(),
  from: z.string().min(1).max(255),
  to: z.string().min(1).max(255),
});
const deleteFileArgs = z.object({ skill: z.string(), path: z.string().min(1).max(255) });

/** Build the authoring tool set for an endpoint (root or a single workspace). */
export function buildAuthoringTools(deps: AuthoringDeps): AuthoringTool[] {
  const { store, workspaceSlug } = deps;
  const scope = workspaceSlug ? ` (scoped to workspace "${workspaceSlug}")` : '';

  return [
    {
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
      run: async (args) => {
        const input = parseArgs(createArgs, args);
        const resolved = input.name ?? (input.title ? slugifySkillName(input.title) : undefined);
        if (!resolved) {
          throw new Error('Provide a "name" or a "title" to create a skill');
        }
        const parsedName = skillNameSchema.safeParse(resolved);
        if (!parsedName.success) {
          throw new Error(
            `Invalid skill name "${resolved}" — lowercase alphanumerics, dots, dashes, underscores, must start alphanumeric`,
          );
        }
        const name = parsedName.data;
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
        return `Created skill "${skill.name}" (${skill.format}). ${whereVisible(skill, workspaceSlug)}`;
      },
    },
    {
      definition: {
        name: 'update_skill',
        description:
          'Update an existing skill in place: replace its `description` and/or its Markdown `body`, and/or ' +
          'toggle its `global` visibility on the root /mcp endpoint. Preserves the skill format, supporting ' +
          'files and any hand-added frontmatter. Use rename_skill to change the slug and write_skill_file to ' +
          'change supporting files.',
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
      run: async (args) => {
        const input = parseArgs(updateArgs, args);
        const skill = await guard(() =>
          store.updateSkill(input.name, {
            description: input.description,
            body: input.body,
            global: input.global,
            tags: input.tags,
          }),
        );
        return `Updated skill "${skill.name}". ${whereVisible(skill, workspaceSlug)} ${fileSummary(skill)}`;
      },
    },
    {
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
      run: async (args) => {
        const input = parseArgs(renameArgs, args);
        const target = skillNameSchema.safeParse(input.new_name);
        if (!target.success) {
          throw new Error(`Invalid skill name "${input.new_name}"`);
        }
        const skill = await guard(() => store.renameSkill(input.name, target.data));
        if (workspaceSlug) {
          // Keep the active workspace's member list pointing at the renamed skill.
          await guard(() => store.removeSkillFromWorkspace(workspaceSlug, input.name));
          await guard(() => store.addSkillToWorkspace(workspaceSlug, skill.name));
        }
        return `Renamed skill "${input.name}" to "${skill.name}". ${whereVisible(skill, workspaceSlug)}`;
      },
    },
    {
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
      run: async (args) => {
        const input = parseArgs(deleteArgs, args);
        await guard(() => store.deleteSkill(input.name));
        if (workspaceSlug) {
          await guard(() => store.removeSkillFromWorkspace(workspaceSlug, input.name));
        }
        return `Deleted skill "${input.name}".`;
      },
    },
    {
      definition: {
        name: 'write_skill_file',
        description:
          'Add or overwrite a supporting file inside a skill (e.g. reference.md, scripts/run.py). ' +
          'Promotes a `file`-format skill to a directory automatically. Binary content must be base64-encoded.',
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
      run: async (args) => {
        const input = parseArgs(writeFileArgs, args);
        const skill = await guard(() =>
          store.writeSupportingFile(input.skill, input.path, Buffer.from(input.content, input.encoding ?? 'utf8')),
        );
        return `Wrote "${input.path}" to skill "${skill.name}". ${fileSummary(skill)}`;
      },
    },
    {
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
      run: async (args) => {
        const input = parseArgs(readFileArgs, args);
        const file = await guard(() => store.readSupportingFile(input.skill, input.path));
        if (file.binary) {
          return `${input.path} (${file.size} bytes, binary, base64):\n${file.content}`;
        }
        return file.content;
      },
    },
    {
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
      run: async (args) => {
        const input = parseArgs(folderArgs, args);
        const skill = await guard(() => store.createSupportingFolder(input.skill, input.path));
        return `Created folder "${input.path}" in skill "${skill.name}".`;
      },
    },
    {
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
      run: async (args) => {
        const input = parseArgs(moveArgs, args);
        const skill = await guard(() => store.moveSupportingPath(input.skill, input.from, input.to));
        return `Moved "${input.from}" to "${input.to}" in skill "${skill.name}".`;
      },
    },
    {
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
      run: async (args) => {
        const input = parseArgs(deleteFileArgs, args);
        const skill = await guard(() => store.deleteSupportingFile(input.skill, input.path));
        return `Deleted "${input.path}" from skill "${skill.name}". ${fileSummary(skill)}`;
      },
    },
  ];
}
