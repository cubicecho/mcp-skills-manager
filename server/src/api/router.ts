import type { ProfileConfig, ProfileStatus, ServerStatus, Skill, SkillDetail, SkillSummary } from '@mcp-skills/shared';
import {
  createProfileRequestSchema,
  createSkillRequestSchema,
  profileConfigSchema,
  profileSlugSchema,
  skillNameSchema,
  slugify,
  slugifySkillName,
  updateProfileRequestSchema,
  updateSkillRequestSchema,
} from '@mcp-skills/shared';
import { Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
import { HttpError } from '../errors.ts';
import { SERVER_VERSION } from '../version.ts';

export interface ApiDeps {
  store: ConfigStore;
}

function toSummary(skill: Skill): SkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    format: skill.format,
    path: skill.path,
    updatedAt: skill.updatedAt,
    files: skill.files,
  };
}

function toDetail(skill: Skill): SkillDetail {
  return { ...toSummary(skill), body: skill.body, frontmatter: skill.frontmatter };
}

export function createApiRouter(deps: ApiDeps): Router {
  const { store } = deps;
  const startedAt = Date.now();
  const router = Router();

  const requireSkill = (name: string): Skill => {
    const skill = store.getSkill(name);
    if (!skill) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    return skill;
  };

  // --- status ---

  router.get('/status', (_req, res) => {
    const status: ServerStatus = {
      version: SERVER_VERSION,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      skillCount: store.getSkills().length,
      profileCount: store.getProfiles().length,
      authEnabled: store.getSettings().authEnabled,
    };
    res.json(status);
  });

  // --- skills ---

  router.get('/skills', (_req, res) => {
    res.json(store.getSkills().map(toSummary));
  });

  router.post('/skills', async (req, res) => {
    const request = createSkillRequestSchema.parse(req.body);
    const name = request.name ?? (request.title ? slugifySkillName(request.title) : undefined);
    if (!name) {
      throw new HttpError(400, 'A "name" or "title" is required to create a skill');
    }
    const parsed = skillNameSchema.safeParse(name);
    if (!parsed.success) {
      throw new HttpError(400, `Invalid skill name "${name}"`, 'lowercase alphanumerics, dots, dashes, underscores');
    }
    const skill = await store.createSkill({
      name: parsed.data,
      description: request.description,
      body: request.body,
    });
    res.status(201).json(toDetail(skill));
  });

  router.get('/skills/:name', (req, res) => {
    res.json(toDetail(requireSkill(req.params.name)));
  });

  router.patch('/skills/:name', async (req, res) => {
    const name = req.params.name;
    requireSkill(name);
    const update = updateSkillRequestSchema.parse(req.body);
    let skill = await store.updateSkill(name, { description: update.description, body: update.body });
    if (update.name !== undefined && update.name !== name) {
      skill = await store.renameSkill(name, update.name);
    }
    res.json(toDetail(skill));
  });

  router.delete('/skills/:name', async (req, res) => {
    await store.deleteSkill(req.params.name);
    res.status(204).end();
  });

  // --- profiles ---

  const profilePath = (slug: string): string => `/mcp/p/${slug}`;
  const toProfileStatus = (profile: ProfileConfig): ProfileStatus => ({
    ...profile,
    path: profilePath(profile.slug),
    resolvedCount: store.getSkillsForProfile(profile).length,
  });

  const requireProfile = (slug: string): ProfileConfig => {
    const profile = store.getProfile(slug);
    if (!profile) {
      throw new HttpError(404, `Unknown profile "${slug}"`);
    }
    return profile;
  };

  /** Every listed skill must currently exist. */
  const assertSkillsExist = (skills: string[] | undefined): void => {
    for (const name of skills ?? []) {
      if (!store.getSkill(name)) {
        throw new HttpError(400, `Unknown skill "${name}" in profile`);
      }
    }
  };

  const requireValidSlug = (slug: string): string => {
    const parsed = profileSlugSchema.safeParse(slug);
    if (!parsed.success) {
      throw new HttpError(400, `Invalid profile slug "${slug}"`, 'derive a name that yields a valid URL slug');
    }
    return parsed.data;
  };

  router.get('/profiles', (_req, res) => {
    res.json(store.getProfiles().map(toProfileStatus));
  });

  router.post('/profiles', async (req, res) => {
    const request = createProfileRequestSchema.parse(req.body);
    const slug = requireValidSlug(request.slug ?? slugify(request.name));
    if (store.getProfile(slug)) {
      throw new HttpError(409, `Profile "${slug}" already exists`);
    }
    assertSkillsExist(request.skills);
    const config = profileConfigSchema.parse({
      name: request.name,
      slug,
      enabled: request.enabled ?? true,
      description: request.description,
      skills: request.skills ?? [],
    });
    await store.saveProfile(config);
    res.status(201).json(toProfileStatus(config));
  });

  router.get('/profiles/:slug', (req, res) => {
    res.json(toProfileStatus(requireProfile(req.params.slug)));
  });

  router.patch('/profiles/:slug', async (req, res) => {
    const existing = requireProfile(req.params.slug);
    const update = updateProfileRequestSchema.parse(req.body);
    assertSkillsExist(update.skills);
    // Auto-slug: renaming re-derives the slug (and thus the URL). Keep the old
    // slug when the name is unchanged so member-only edits never move the URL.
    const name = update.name ?? existing.name;
    const slug = update.name !== undefined ? requireValidSlug(slugify(name)) : existing.slug;
    if (slug !== existing.slug && store.getProfile(slug)) {
      throw new HttpError(409, `Profile "${slug}" already exists`);
    }
    const next = profileConfigSchema.parse({
      ...existing,
      name,
      slug,
      enabled: update.enabled ?? existing.enabled,
      description: update.description !== undefined ? update.description : existing.description,
      skills: update.skills ?? existing.skills,
    });
    await store.saveProfile(next);
    if (slug !== existing.slug) {
      await store.deleteProfile(existing.slug);
    }
    res.json(toProfileStatus(next));
  });

  router.delete('/profiles/:slug', async (req, res) => {
    requireProfile(req.params.slug);
    await store.deleteProfile(req.params.slug);
    res.status(204).end();
  });

  // --- reload ---

  router.post('/reload', async (_req, res) => {
    const state = await store.reload();
    res.json({ reloaded: true, skillCount: state.skills.length, profileCount: state.profiles.length });
  });

  return router;
}
