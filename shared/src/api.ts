import { z } from 'zod';
import { profileConfigSchema, profileSlugSchema } from './profile.ts';
import { skillToolModeSchema } from './settings.ts';
import { skillFileSchema, skillFormatSchema, skillFrontmatterSchema, skillNameSchema } from './skill.ts';

/**
 * DTOs for the management REST API (/api/*).
 * All endpoints require `Authorization: Bearer <token>` unless auth is disabled.
 */

// --- skills ---

/** A skill without its body — the shape returned by GET /api/skills. */
export const skillSummarySchema = z.object({
  name: skillNameSchema,
  description: z.string(),
  format: z.enum(['file', 'dir']),
  /** Whether the skill is served on the root `/mcp` aggregate (false → profile-scoped only). */
  global: z.boolean().default(true),
  path: z.string(),
  updatedAt: z.string(),
  files: z.array(skillFileSchema),
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

/** A skill with its full Markdown body — GET /api/skills/:name. */
export const skillDetailSchema = skillSummarySchema.extend({
  body: z.string(),
  frontmatter: skillFrontmatterSchema,
});
export type SkillDetail = z.infer<typeof skillDetailSchema>;

// --- POST /api/skills ---

export const createSkillRequestSchema = z.object({
  /** Id / route filter value; derived from `title` when omitted. */
  name: skillNameSchema.optional(),
  /** Free-form title used to derive `name` when it is not given. */
  title: z.string().optional(),
  /** One-line summary, written to frontmatter. */
  description: z.string().default(''),
  /** Markdown body (frontmatter is generated from name/description). */
  body: z.string().default(''),
  /** On-disk layout: `file` → `<name>.md`, `dir` → `<name>/SKILL.md`. Defaults to `file`. */
  format: skillFormatSchema.optional(),
  /** Serve on the root `/mcp` aggregate. Omit for the default (true); false → profile-scoped only. */
  global: z.boolean().optional(),
});
export type CreateSkillRequest = z.infer<typeof createSkillRequestSchema>;

// --- POST /api/skills/import (upload an .md / directory / .zip) ---

/**
 * One file in an upload payload. `content` is the raw file body, encoded as
 * `utf8` text or `base64` (used for binary supporting files). `path` is relative
 * to the skill's root, e.g. "SKILL.md" or "scripts/run.py".
 */
export const skillFileContentSchema = z.object({
  path: z.string().min(1).max(255),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
});
export type SkillFileContent = z.infer<typeof skillFileContentSchema>;

/**
 * Create a skill from an upload. The client normalizes an .md file, a picked
 * directory, or an unzipped .zip into this shape: a `format` plus a flat file
 * list. A `dir` import must include a `SKILL.md`; a `file` import carries the
 * single Markdown file written verbatim as `<name>.md`.
 */
export const importSkillRequestSchema = z.object({
  name: skillNameSchema.optional(),
  title: z.string().optional(),
  format: skillFormatSchema,
  files: z.array(skillFileContentSchema).min(1).max(500),
});
export type ImportSkillRequest = z.infer<typeof importSkillRequestSchema>;

// --- PUT /api/skills/:name/files (add or replace a supporting file) ---

/** Add or overwrite one supporting file under a skill's directory; promotes a `file` skill to `dir`. */
export const writeSkillFileRequestSchema = skillFileContentSchema;
export type WriteSkillFileRequest = z.infer<typeof writeSkillFileRequestSchema>;

// --- GET /api/skills/:name/files/content?path=… (read one supporting file) ---

/** The content of a single supporting file. Binary files come back base64-encoded with `binary: true`. */
export const skillFileReadSchema = z.object({
  path: z.string(),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']),
  size: z.number().int().nonnegative(),
  /** True when the file is not valid UTF-8 text and should not be opened in the text editor. */
  binary: z.boolean(),
});
export type SkillFileRead = z.infer<typeof skillFileReadSchema>;

// --- POST /api/skills/:name/folders (create an empty sub-directory) ---

export const createSkillFolderRequestSchema = z.object({
  /** Directory path relative to the skill root, e.g. "reference/examples". */
  path: z.string().min(1).max(255),
});
export type CreateSkillFolderRequest = z.infer<typeof createSkillFolderRequestSchema>;

// --- POST /api/skills/:name/files/move (rename or move a file or folder) ---

export const moveSkillPathRequestSchema = z.object({
  /** Existing file/folder path, relative to the skill root. */
  from: z.string().min(1).max(255),
  /** New path, relative to the skill root. */
  to: z.string().min(1).max(255),
});
export type MoveSkillPathRequest = z.infer<typeof moveSkillPathRequestSchema>;

// --- PATCH /api/skills/:name ---

export const updateSkillRequestSchema = z.object({
  /** Rename the skill (moves the file/dir). */
  name: skillNameSchema.optional(),
  description: z.string().optional(),
  body: z.string().optional(),
  /** Toggle whether the skill is served on the root `/mcp` aggregate. */
  global: z.boolean().optional(),
});
export type UpdateSkillRequest = z.infer<typeof updateSkillRequestSchema>;

// --- /api/profiles ---

/** A profile as returned by the API: its stored config plus the derived endpoint path. */
export const profileStatusSchema = profileConfigSchema.extend({
  /** Endpoint path of the profile's filtered aggregate, e.g. "/mcp/p/backend". */
  path: z.string(),
  /** Number of member skills that currently exist on disk. */
  resolvedCount: z.number().int().nonnegative(),
});
export type ProfileStatus = z.infer<typeof profileStatusSchema>;

export const createProfileRequestSchema = z.object({
  name: z.string().min(1).max(100),
  /** Slug for the URL; derived from `name` when omitted. */
  slug: profileSlugSchema.optional(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  skills: z.array(skillNameSchema).optional(),
  /** Override the global skill-tool mode for this profile's endpoint (omit to inherit). */
  skillToolMode: skillToolModeSchema.optional(),
});
export type CreateProfileRequest = z.infer<typeof createProfileRequestSchema>;

export const updateProfileRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  /** Full replacement of the member list when provided. */
  skills: z.array(skillNameSchema).optional(),
  /** Set to override the global skill-tool mode, or `null` to clear the override and inherit. */
  skillToolMode: skillToolModeSchema.nullable().optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

// --- GET /api/status ---

export interface ServerStatus {
  version: string;
  uptimeSeconds: number;
  skillCount: number;
  profileCount: number;
  authEnabled: boolean;
  /** The port the HTTP server is actually listening on. */
  port: number;
}

/** Standard error envelope for non-2xx responses. */
export interface ApiError {
  error: string;
  detail?: string;
}
