import { z } from 'zod';
import { profileConfigSchema, profileSlugSchema } from './profile.ts';
import { skillFileSchema, skillFrontmatterSchema, skillNameSchema } from './skill.ts';

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
});
export type CreateSkillRequest = z.infer<typeof createSkillRequestSchema>;

// --- PATCH /api/skills/:name ---

export const updateSkillRequestSchema = z.object({
  /** Rename the skill (moves the file/dir). */
  name: skillNameSchema.optional(),
  description: z.string().optional(),
  body: z.string().optional(),
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
});
export type CreateProfileRequest = z.infer<typeof createProfileRequestSchema>;

export const updateProfileRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  /** Full replacement of the member list when provided. */
  skills: z.array(skillNameSchema).optional(),
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
