import { z } from 'zod';
import { skillToolModeSchema } from './settings.ts';
import {
  fileEncodingSchema,
  skillFileSchema,
  skillFormatSchema,
  skillFrontmatterSchema,
  skillRelPathSchema,
} from './skill.ts';
import { gitSourceSchema, skillSourceSchema } from './skill-source.ts';
import { slugSchema } from './slug.ts';
import { workspaceConfigSchema } from './workspace.ts';

/**
 * DTOs for the management REST API (/api/*).
 * All endpoints require `Authorization: Bearer <token>` unless auth is disabled.
 */

/** Runtime usage stats for a skill: how often it has been loaded over MCP, and when last. */
export const skillUsageSchema = z.object({
  /** Number of times the skill body has been loaded (per-skill tool or `load_skill`). */
  count: z.number().int().nonnegative(),
  /** ISO 8601 timestamp of the most recent load, or null if never loaded. */
  lastUsedAt: z.string().nullable(),
});
export type SkillUsage = z.infer<typeof skillUsageSchema>;

/** A skill without its body — the shape returned by GET /api/skills. */
export const skillSummarySchema = z.object({
  name: slugSchema,
  description: z.string(),
  format: skillFormatSchema,
  /** Whether the skill is served on the root `/mcp` aggregate (false → workspace-scoped only). */
  global: z.boolean().default(true),
  /** Whether agents are barred from modifying the skill over MCP (the web UI can still edit it). */
  readOnly: z.boolean().default(false),
  path: z.string(),
  updatedAt: z.string(),
  files: z.array(skillFileSchema),
  /** Normalized tags/categories for organising and filtering. */
  tags: z.array(z.string()).default([]),
  /** The git folder the skill is linked to; a linked skill's content is locked until it is unlinked. */
  source: skillSourceSchema.optional(),
  /** Load-usage stats for the skill. */
  usage: skillUsageSchema.default({ count: 0, lastUsedAt: null }),
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

/** A skill with its full Markdown body — GET /api/skills/:name. */
export const skillDetailSchema = skillSummarySchema.extend({
  body: z.string(),
  frontmatter: skillFrontmatterSchema,
});
export type SkillDetail = z.infer<typeof skillDetailSchema>;

/** Body of POST /api/skills. */
export const createSkillRequestSchema = z.object({
  /** Id / route filter value; derived from `title` when omitted. */
  name: slugSchema.optional(),
  /** Free-form title used to derive `name` when it is not given. */
  title: z.string().optional(),
  /** One-line summary, written to frontmatter. */
  description: z.string().default(''),
  /** Markdown body (frontmatter is generated from name/description). */
  body: z.string().default(''),
  /** On-disk layout: `file` → `<name>.md`, `dir` → `<name>/SKILL.md`. Defaults to `file`. */
  format: skillFormatSchema.optional(),
  /** Serve on the root `/mcp` aggregate. Omit for the default (true); false → workspace-scoped only. */
  global: z.boolean().optional(),
  /** Tags/categories, written to frontmatter. */
  tags: z.array(z.string()).optional(),
});
export type CreateSkillRequest = z.infer<typeof createSkillRequestSchema>;

/**
 * One file in an upload payload. `content` is the raw file body, encoded as
 * `utf8` text or `base64` (used for binary supporting files). `path` is relative
 * to the skill's root, e.g. "SKILL.md" or "scripts/run.py".
 */
export const skillFileContentSchema = z.object({
  path: skillRelPathSchema,
  content: z.string(),
  encoding: fileEncodingSchema.default('utf8'),
});
export type SkillFileContent = z.infer<typeof skillFileContentSchema>;

/**
 * Body of POST /api/skills/import: create a skill from an upload. The client normalizes an .md file, a picked
 * directory, or an unzipped .zip into this shape: a `format` plus a flat file
 * list. A `dir` import must include a `SKILL.md`; a `file` import carries the
 * single Markdown file written verbatim as `<name>.md`.
 */
export const importSkillRequestSchema = z.object({
  name: slugSchema.optional(),
  title: z.string().optional(),
  format: skillFormatSchema,
  files: z.array(skillFileContentSchema).min(1).max(500),
});
export type ImportSkillRequest = z.infer<typeof importSkillRequestSchema>;

/** Body of POST /api/skills/import-git: create a skill linked to a folder in a git repo, fetching it right away. */
export const importGitSkillRequestSchema = gitSourceSchema.extend({
  /** Id for the new skill; the upstream frontmatter `name` (else the folder name) when omitted. */
  name: slugSchema.optional(),
  /** Serve on the root `/mcp` aggregate. Omit for the default (true); false → workspace-scoped only. */
  global: z.boolean().optional(),
});
export type ImportGitSkillRequest = z.infer<typeof importGitSkillRequestSchema>;

/** Body of PUT /api/skills/:name/files: add or overwrite one supporting file; promotes a `file` skill to `dir`. */
export const writeSkillFileRequestSchema = skillFileContentSchema;
export type WriteSkillFileRequest = z.infer<typeof writeSkillFileRequestSchema>;

/**
 * Response of GET /api/skills/:name/files/content?path=…: one supporting file. Binary files come back
 * base64-encoded with `binary: true`.
 */
export const skillFileReadSchema = z.object({
  path: z.string(),
  content: z.string(),
  encoding: fileEncodingSchema,
  size: z.number().int().nonnegative(),
  /** True when the file is not valid UTF-8 text and should not be opened in the text editor. */
  binary: z.boolean(),
});
export type SkillFileRead = z.infer<typeof skillFileReadSchema>;

/** Body of POST /api/skills/:name/folders: create an empty sub-directory. */
export const createSkillFolderRequestSchema = z.object({
  /** Directory path relative to the skill root, e.g. "reference/examples". */
  path: skillRelPathSchema,
});
export type CreateSkillFolderRequest = z.infer<typeof createSkillFolderRequestSchema>;

/** Body of POST /api/skills/:name/files/move: rename or move a file or folder. */
export const moveSkillPathRequestSchema = z.object({
  /** Existing file/folder path, relative to the skill root. */
  from: skillRelPathSchema,
  /** New path, relative to the skill root. */
  to: skillRelPathSchema,
});
export type MoveSkillPathRequest = z.infer<typeof moveSkillPathRequestSchema>;

/** Body of PATCH /api/skills/:name. */
export const updateSkillRequestSchema = z.object({
  /** Rename the skill (moves the file/dir). */
  name: slugSchema.optional(),
  description: z.string().optional(),
  body: z.string().optional(),
  /** Toggle whether the skill is served on the root `/mcp` aggregate. */
  global: z.boolean().optional(),
  /** Mark the skill read-only (agents can no longer modify it over MCP) or lift that protection. */
  readOnly: z.boolean().optional(),
  /** Replace the skill's tags/categories. */
  tags: z.array(z.string()).optional(),
});
export type UpdateSkillRequest = z.infer<typeof updateSkillRequestSchema>;

/** Response of POST /api/skills/:name/sync. */
export const syncSkillResponseSchema = z.object({
  skill: skillDetailSchema,
  /** False when the source was already at the commit the skill was last synced from. */
  changed: z.boolean(),
});
export type SyncSkillResponse = z.infer<typeof syncSkillResponseSchema>;

/** A workspace as returned by /api/workspaces: its stored config plus the derived endpoint path. */
export const workspaceStatusSchema = workspaceConfigSchema.extend({
  /** Endpoint path of the workspace's filtered aggregate, e.g. "/mcp/w/backend". */
  path: z.string(),
  /** Number of member skills that currently exist on disk. */
  resolvedCount: z.number().int().nonnegative(),
});
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

/** Body of POST /api/workspaces. */
export const createWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(100),
  /** Slug for the URL; derived from `name` when omitted. */
  slug: slugSchema.optional(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  skills: z.array(slugSchema).optional(),
  /** Override the global skill-tool mode for this workspace's endpoint (omit to inherit). */
  skillToolMode: skillToolModeSchema.optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

/** Body of PATCH /api/workspaces/:slug; a new name moves the slug with it. */
export const updateWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  /** Full replacement of the member list when provided. */
  skills: z.array(slugSchema).optional(),
  /** Set to override the global skill-tool mode, or `null` to clear the override and inherit. */
  skillToolMode: skillToolModeSchema.nullable().optional(),
});
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

/** Response of GET /api/status. */
export const serverStatusSchema = z.object({
  version: z.string(),
  /** Seconds since the server process started serving. */
  uptimeSeconds: z.number(),
  skillCount: z.number(),
  workspaceCount: z.number(),
  authEnabled: z.boolean(),
  /** The port the HTTP server is actually listening on. */
  port: z.number(),
});
export type ServerStatus = z.infer<typeof serverStatusSchema>;

/** Standard error envelope for non-2xx responses. */
export const apiErrorSchema = z.object({
  error: z.string(),
  detail: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
