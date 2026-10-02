import type {
  ServerStatus,
  Skill,
  SkillDetail,
  SkillSummary,
  WorkspaceConfig,
  WorkspaceStatus,
} from '@mcp-skills/shared';
import {
  createSkillFolderRequestSchema,
  createSkillRequestSchema,
  createWorkspaceRequestSchema,
  importSkillRequestSchema,
  moveSkillPathRequestSchema,
  slugify,
  slugSchema,
  updateSettingsRequestSchema,
  updateSkillRequestSchema,
  updateWorkspaceRequestSchema,
  workspaceConfigSchema,
  writeSkillFileRequestSchema,
} from '@mcp-skills/shared';
import { Router } from 'express';
import { authDisabledByEnv } from '../auth.ts';
import type { ConfigStore } from '../config/store.ts';
import { HttpError } from '../errors.ts';
import { resolveSkillName } from '../skills/skill-name.ts';
import { SERVER_VERSION } from '../version.ts';

/** What the management API needs from the process that mounts it. */
export interface ApiDeps {
  store: ConfigStore;
  /** The port the HTTP server is listening on, surfaced via GET /status. */
  port: number;
}

/**
 * Builds the body-less API view of a skill.
 * @param store Store supplying the usage stats.
 * @param skill Skill to render.
 * @returns The summary DTO.
 */
function toSummary(store: ConfigStore, skill: Skill): SkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    format: skill.format,
    global: skill.global,
    readOnly: skill.readOnly,
    path: skill.path,
    updatedAt: skill.updatedAt,
    files: skill.files,
    tags: skill.tags,
    usage: store.getUsage(skill.name),
  };
}

/**
 * Builds the full API view of a skill.
 * @param store Store supplying the usage stats.
 * @param skill Skill to render.
 * @returns The summary plus body and frontmatter.
 */
function toDetail(store: ConfigStore, skill: Skill): SkillDetail {
  return { ...toSummary(store, skill), body: skill.body, frontmatter: skill.frontmatter };
}

/**
 * Resolves the name of a skill being created or imported, answering 400 when the request yields none.
 * @param request Parsed request body carrying an optional name and title.
 * @param action Verb used in the error message.
 * @returns A valid skill slug.
 */
function requireSkillName(request: { name?: string; title?: string }, action: 'create' | 'import'): string {
  const name = resolveSkillName(request.name, request.title);
  if (!name) {
    throw new HttpError(400, `A "name" or "title" is required to ${action} a skill`);
  }
  const parsed = slugSchema.safeParse(name);
  if (!parsed.success) {
    throw new HttpError(400, `Invalid skill name "${name}"`, 'lowercase alphanumerics, dots, dashes, underscores');
  }
  return parsed.data;
}

/**
 * Builds the management REST API mounted at /api.
 * @param deps Store and listening port.
 * @returns The router; errors thrown by its handlers reach the error middleware.
 */
export function createApiRouter(deps: ApiDeps): Router {
  const { store, port } = deps;
  const startedAt = Date.now();
  const router = Router();

  const requireSkill = (name: string): Skill => {
    const skill = store.getSkill(name);
    if (!skill) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    return skill;
  };

  router.get('/status', (_req, res) => {
    const status: ServerStatus = {
      version: SERVER_VERSION,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      skillCount: store.getSkills().length,
      workspaceCount: store.getWorkspaces().length,
      // Report the *effective* auth state: SECURE_LOCAL_NET overrides settings.json,
      // matching the auth middleware in app.ts.
      authEnabled: store.getSettings().authEnabled && !authDisabledByEnv(),
      port,
    };
    res.json(status);
  });

  router.get('/settings', (_req, res) => {
    res.json(store.getSettingsView());
  });

  router.patch('/settings', async (req, res) => {
    const update = updateSettingsRequestSchema.parse(req.body);
    await store.updateSettings(update);
    res.json(store.getSettingsView());
  });

  router.get('/skills', (_req, res) => {
    res.json(store.getSkills().map((skill) => toSummary(store, skill)));
  });

  router.post('/skills', async (req, res) => {
    const request = createSkillRequestSchema.parse(req.body);
    const skill = await store.createSkill({
      name: requireSkillName(request, 'create'),
      description: request.description,
      body: request.body,
      format: request.format,
      global: request.global,
      tags: request.tags,
    });
    res.status(201).json(toDetail(store, skill));
  });

  // Create a skill from an uploaded .md / directory / zip (normalized client-side).
  router.post('/skills/import', async (req, res) => {
    const request = importSkillRequestSchema.parse(req.body);
    const name = requireSkillName(request, 'import');
    const files = request.files.map((file) => ({
      path: file.path,
      content: Buffer.from(file.content, file.encoding),
    }));
    const skill = await store.importSkill({ name, format: request.format, files });
    res.status(201).json(toDetail(store, skill));
  });

  router.get('/skills/:name', (req, res) => {
    res.json(toDetail(store, requireSkill(req.params.name)));
  });

  router.patch('/skills/:name', async (req, res) => {
    const name = req.params.name;
    requireSkill(name);
    const update = updateSkillRequestSchema.parse(req.body);
    let skill = await store.updateSkill(name, {
      description: update.description,
      body: update.body,
      global: update.global,
      readOnly: update.readOnly,
      tags: update.tags,
    });
    if (update.name !== undefined && update.name !== name) {
      skill = await store.renameSkill(name, update.name);
    }
    res.json(toDetail(store, skill));
  });

  router.delete('/skills/:name', async (req, res) => {
    await store.deleteSkill(req.params.name);
    res.status(204).end();
  });

  // Export a skill as a .zip download.
  router.get('/skills/:name/export', async (req, res) => {
    const name = req.params.name;
    requireSkill(name);
    const zip = await store.exportSkillZip(name);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
    res.send(zip);
  });

  // Read one supporting file's content: GET /skills/:name/files/content?path=<relative path>
  router.get('/skills/:name/files/content', async (req, res) => {
    const name = req.params.name;
    requireSkill(name);
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relPath) {
      throw new HttpError(400, 'A "path" query parameter is required');
    }
    res.json(await store.readSupportingFile(name, relPath));
  });

  // Add or overwrite a supporting file (promotes a `file` skill to a `dir`).
  router.put('/skills/:name/files', async (req, res) => {
    const name = req.params.name;
    requireSkill(name);
    const request = writeSkillFileRequestSchema.parse(req.body);
    const skill = await store.writeSupportingFile(name, request.path, Buffer.from(request.content, request.encoding));
    res.json(toDetail(store, skill));
  });

  // Create an empty sub-directory under a skill (promotes a `file` skill to a `dir`).
  router.post('/skills/:name/folders', async (req, res) => {
    const name = req.params.name;
    requireSkill(name);
    const request = createSkillFolderRequestSchema.parse(req.body);
    const skill = await store.createSupportingFolder(name, request.path);
    res.json(toDetail(store, skill));
  });

  // Rename or move a supporting file or folder.
  router.post('/skills/:name/files/move', async (req, res) => {
    const name = req.params.name;
    requireSkill(name);
    const request = moveSkillPathRequestSchema.parse(req.body);
    const skill = await store.moveSupportingPath(name, request.from, request.to);
    res.json(toDetail(store, skill));
  });

  // Delete a supporting file or folder: DELETE /skills/:name/files?path=<relative path>
  router.delete('/skills/:name/files', async (req, res) => {
    const name = req.params.name;
    requireSkill(name);
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relPath) {
      throw new HttpError(400, 'A "path" query parameter is required');
    }
    const skill = await store.deleteSupportingFile(name, relPath);
    res.json(toDetail(store, skill));
  });

  const workspacePath = (slug: string): string => `/mcp/w/${slug}`;
  const toWorkspaceStatus = (workspace: WorkspaceConfig): WorkspaceStatus => ({
    ...workspace,
    path: workspacePath(workspace.slug),
    resolvedCount: store.getSkillsForWorkspace(workspace).length,
  });

  const requireWorkspace = (slug: string): WorkspaceConfig => {
    const workspace = store.getWorkspace(slug);
    if (!workspace) {
      throw new HttpError(404, `Unknown workspace "${slug}"`);
    }
    return workspace;
  };

  const requireValidSlug = (slug: string): string => {
    const parsed = slugSchema.safeParse(slug);
    if (!parsed.success) {
      throw new HttpError(400, `Invalid workspace slug "${slug}"`, 'derive a name that yields a valid URL slug');
    }
    return parsed.data;
  };

  router.get('/workspaces', (_req, res) => {
    res.json(store.getWorkspaces().map(toWorkspaceStatus));
  });

  router.post('/workspaces', async (req, res) => {
    const request = createWorkspaceRequestSchema.parse(req.body);
    const slug = requireValidSlug(request.slug ?? slugify(request.name));
    if (store.getWorkspace(slug)) {
      throw new HttpError(409, `Workspace "${slug}" already exists`);
    }
    const config = workspaceConfigSchema.parse({
      name: request.name,
      slug,
      enabled: request.enabled ?? true,
      description: request.description,
      skills: request.skills ?? [],
      skillToolMode: request.skillToolMode,
    });
    const saved = await store.saveWorkspace(config);
    res.status(201).json(toWorkspaceStatus(saved));
  });

  router.get('/workspaces/:slug', (req, res) => {
    res.json(toWorkspaceStatus(requireWorkspace(req.params.slug)));
  });

  router.patch('/workspaces/:slug', async (req, res) => {
    const existing = requireWorkspace(req.params.slug);
    const update = updateWorkspaceRequestSchema.parse(req.body);
    // Auto-slug: renaming re-derives the slug (and thus the URL). Keep the old
    // slug when the name is unchanged so member-only edits never move the URL.
    const name = update.name ?? existing.name;
    const slug = update.name !== undefined ? requireValidSlug(slugify(name)) : existing.slug;
    if (slug !== existing.slug && store.getWorkspace(slug)) {
      throw new HttpError(409, `Workspace "${slug}" already exists`);
    }
    // skillToolMode: undefined → keep; null → clear the override (inherit global); a value → set it.
    const skillToolMode =
      update.skillToolMode === undefined ? existing.skillToolMode : (update.skillToolMode ?? undefined);
    const next = workspaceConfigSchema.parse({
      ...existing,
      name,
      slug,
      enabled: update.enabled ?? existing.enabled,
      description: update.description !== undefined ? update.description : existing.description,
      skills: update.skills ?? existing.skills,
      skillToolMode,
    });
    const saved = await store.saveWorkspace(next);
    if (slug !== existing.slug) {
      await store.deleteWorkspace(existing.slug);
    }
    res.json(toWorkspaceStatus(saved));
  });

  router.delete('/workspaces/:slug', async (req, res) => {
    requireWorkspace(req.params.slug);
    await store.deleteWorkspace(req.params.slug);
    res.status(204).end();
  });

  router.post('/reload', async (_req, res) => {
    const state = await store.reload();
    res.json({ reloaded: true, skillCount: state.skills.length, workspaceCount: state.workspaces.length });
  });

  return router;
}
