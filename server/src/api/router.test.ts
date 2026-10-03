import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../config/store.ts';
import { errorMiddleware } from './error-middleware.ts';
import { createApiRouter } from './router.ts';

/**
 * Builds the management API on a bare express app (auth off), as app.ts mounts it.
 * @param store Store the router reads and writes.
 * @returns The app, ready for supertest.
 */
function buildApi(store: ConfigStore): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter({ store, port: 4321 }));
  app.use(errorMiddleware);
  return app;
}

/**
 * Asserts a request-body validation failure without pinning its status or envelope.
 *
 * Whether errorMiddleware recognises a shared-schema ZodError depends on how zod is installed: with one copy the
 * answer is 400 { error: 'Validation failed', detail }, with a copy per package it is 500 with the issues as `error`.
 * @param res Response to check.
 * @param issueMessage Zod issue message the response must carry.
 */
function expectValidationFailure(res: request.Response, issueMessage: string): void {
  expect([400, 500]).toContain(res.status);
  expect(JSON.stringify(res.body)).toContain(issueMessage);
}

describe('management REST API', () => {
  let dir: string;
  let store: ConfigStore;
  let api: express.Express;

  beforeEach(async () => {
    vi.stubEnv('SECURE_LOCAL_NET', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-api-'));
    store = new ConfigStore(dir);
    await store.init(); // seeds getting-started + examples workspace
    api = buildApi(store);
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('status, settings and reload', () => {
    it('reports counts, the listening port and the effective auth state', async () => {
      const res = await request(api).get('/api/status');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ skillCount: 1, workspaceCount: 1, authEnabled: true, port: 4321 });
      expect(typeof res.body.version).toBe('string');
      expect(typeof res.body.uptimeSeconds).toBe('number');
      expect(Object.keys(res.body).sort()).toEqual([
        'authEnabled',
        'port',
        'skillCount',
        'uptimeSeconds',
        'version',
        'workspaceCount',
      ]);
    });

    it('reports auth as off when SECURE_LOCAL_NET overrides settings', async () => {
      vi.stubEnv('SECURE_LOCAL_NET', 'true');
      const res = await request(api).get('/api/status');
      expect(res.body.authEnabled).toBe(false);
    });

    it('returns the token-free settings view and applies a patch', async () => {
      const before = await request(api).get('/api/settings');
      expect(before.body).toEqual({
        authEnabled: true,
        authoringEnabled: true,
        skillToolMode: 'per-skill',
        httpLiveUpdates: false,
      });
      const after = await request(api).patch('/api/settings').send({ skillToolMode: 'loader' });
      expect(after.status).toBe(200);
      expect(after.body.skillToolMode).toBe('loader');
    });

    it('rejects an unknown settings key and leaves settings alone', async () => {
      const res = await request(api).patch('/api/settings').send({ authEnabled: false });
      expectValidationFailure(res, "Unrecognized key(s) in object: 'authEnabled'");
      expect(store.getSettings().authEnabled).toBe(true);
    });

    it('reloads from disk and reports the counts', async () => {
      const res = await request(api).post('/api/reload');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reloaded: true, skillCount: 1, workspaceCount: 1 });
    });
  });

  describe('creating skills', () => {
    it('creates a file-format skill from a name and returns its detail', async () => {
      const res = await request(api).post('/api/skills').send({ name: 'alpha', description: 'A', body: '# A' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'alpha',
        description: 'A',
        body: '\n# A\n',
        format: 'file',
        global: true,
        readOnly: false,
        path: 'alpha.md',
        files: [],
        tags: [],
        usage: { count: 0, lastUsedAt: null },
        frontmatter: { name: 'alpha', description: 'A' },
      });
    });

    it('derives the name from a title', async () => {
      const res = await request(api).post('/api/skills').send({ title: 'My First Skill!' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('my-first-skill');
    });

    it('requires a name or a title', async () => {
      const res = await request(api).post('/api/skills').send({ description: 'x' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'A "name" or "title" is required to create a skill' });
    });

    it('treats a title that slugifies to nothing as missing', async () => {
      const res = await request(api).post('/api/skills').send({ title: '!!!' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'A "name" or "title" is required to create a skill' });
    });

    it('rejects an invalid explicit name at the request boundary', async () => {
      const res = await request(api).post('/api/skills').send({ name: 'Not A Slug' });
      expectValidationFailure(res, 'lowercase alphanumerics, dots, dashes, underscores; must start alphanumeric');
      expect(store.getSkills()).toHaveLength(1);
    });

    it('answers 409 for a duplicate name', async () => {
      const res = await request(api).post('/api/skills').send({ name: 'getting-started' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Skill "getting-started" already exists' });
    });
  });

  describe('importing skills', () => {
    it('imports a directory skill from a title', async () => {
      const res = await request(api)
        .post('/api/skills/import')
        .send({
          title: 'PDF Forms',
          format: 'dir',
          files: [
            { path: 'SKILL.md', content: '---\nname: pdf-forms\ndescription: Fill forms\n---\n# PDF' },
            { path: 'scripts/fill.py', content: Buffer.from('print(1)').toString('base64'), encoding: 'base64' },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'pdf-forms', format: 'dir', path: 'pdf-forms/SKILL.md' });
      expect(res.body.files).toEqual([
        { path: 'scripts', type: 'dir', size: 0 },
        { path: 'scripts/fill.py', type: 'file', size: 8 },
      ]);
    });

    it('imports a single Markdown file', async () => {
      const res = await request(api)
        .post('/api/skills/import')
        .send({ name: 'notes', format: 'file', files: [{ path: 'notes.md', content: '# Notes' }] });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'notes', format: 'file', path: 'notes.md', body: '# Notes' });
    });

    it('requires a name or a title', async () => {
      const res = await request(api)
        .post('/api/skills/import')
        .send({ format: 'file', files: [{ path: 'a.md', content: 'x' }] });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'A "name" or "title" is required to import a skill' });
    });

    it('answers 400 for a directory import without a SKILL.md', async () => {
      const res = await request(api)
        .post('/api/skills/import')
        .send({ name: 'broken', format: 'dir', files: [{ path: 'readme.md', content: 'x' }] });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'A directory skill must include a SKILL.md at its root' });
    });
  });

  describe('reading, updating and deleting a skill', () => {
    it('lists summaries without bodies', async () => {
      const res = await request(api).get('/api/skills');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(Object.keys(res.body[0]).sort()).toEqual([
        'description',
        'files',
        'format',
        'global',
        'name',
        'path',
        'readOnly',
        'tags',
        'updatedAt',
        'usage',
      ]);
    });

    it('answers 404 for an unknown skill', async () => {
      const res = await request(api).get('/api/skills/nope');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Unknown skill "nope"' });
    });

    it('lets an unknown skill win over an invalid body on PATCH', async () => {
      const res = await request(api).patch('/api/skills/nope').send({ description: 42 });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Unknown skill "nope"' });
    });

    it('updates fields and renames in one PATCH', async () => {
      const res = await request(api)
        .patch('/api/skills/getting-started')
        .send({ name: 'welcome', description: 'Hello', readOnly: true, tags: ['intro'] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'welcome', description: 'Hello', readOnly: true, tags: ['intro'] });
      expect((await request(api).get('/api/skills/getting-started')).status).toBe(404);
      const workspace = await request(api).get('/api/workspaces/examples');
      expect(workspace.body.skills).toEqual(['welcome']);
    });

    it('deletes a skill with 204, and 404s the second time', async () => {
      expect((await request(api).delete('/api/skills/getting-started')).status).toBe(204);
      const again = await request(api).delete('/api/skills/getting-started');
      expect(again.status).toBe(404);
      expect(again.body).toEqual({ error: 'Unknown skill "getting-started"' });
    });

    it('exports a skill as a zip download', async () => {
      const res = await request(api).get('/api/skills/getting-started/export');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toBe('attachment; filename="getting-started.zip"');
      expect((await request(api).get('/api/skills/nope/export')).status).toBe(404);
    });
  });

  describe('supporting files', () => {
    it('writes, reads, moves and deletes a file, returning the skill detail each time', async () => {
      const written = await request(api)
        .put('/api/skills/getting-started/files')
        .send({ path: 'ref/a.md', content: 'hello' });
      expect(written.status).toBe(200);
      expect(written.body.format).toBe('dir');
      expect(written.body.files).toEqual([
        { path: 'ref', type: 'dir', size: 0 },
        { path: 'ref/a.md', type: 'file', size: 5 },
      ]);

      const read = await request(api).get('/api/skills/getting-started/files/content').query({ path: 'ref/a.md' });
      expect(read.status).toBe(200);
      expect(read.body).toEqual({ path: 'ref/a.md', content: 'hello', encoding: 'utf8', size: 5, binary: false });

      const folder = await request(api).post('/api/skills/getting-started/folders').send({ path: 'empty' });
      expect(folder.status).toBe(200);
      expect(folder.body.files).toContainEqual({ path: 'empty', type: 'dir', size: 0 });

      const moved = await request(api)
        .post('/api/skills/getting-started/files/move')
        .send({ from: 'ref/a.md', to: 'b.md' });
      expect(moved.status).toBe(200);
      expect(moved.body.files).toContainEqual({ path: 'b.md', type: 'file', size: 5 });

      const deleted = await request(api).delete('/api/skills/getting-started/files').query({ path: 'b.md' });
      expect(deleted.status).toBe(200);
      expect(deleted.body.files).toEqual([{ path: 'empty', type: 'dir', size: 0 }]);
    });

    it('requires the path query parameter on read and delete', async () => {
      const read = await request(api).get('/api/skills/getting-started/files/content');
      expect(read.status).toBe(400);
      expect(read.body).toEqual({ error: 'A "path" query parameter is required' });
      const deleted = await request(api).delete('/api/skills/getting-started/files');
      expect(deleted.status).toBe(400);
      expect(deleted.body).toEqual({ error: 'A "path" query parameter is required' });
    });

    it('lets an unknown skill win over a missing path or an invalid body', async () => {
      const unknown = { error: 'Unknown skill "nope"' };
      const read = await request(api).get('/api/skills/nope/files/content');
      expect([read.status, read.body]).toEqual([404, unknown]);
      const deleted = await request(api).delete('/api/skills/nope/files');
      expect([deleted.status, deleted.body]).toEqual([404, unknown]);
      const written = await request(api).put('/api/skills/nope/files').send({});
      expect([written.status, written.body]).toEqual([404, unknown]);
      const folder = await request(api).post('/api/skills/nope/folders').send({});
      expect([folder.status, folder.body]).toEqual([404, unknown]);
      const moved = await request(api).post('/api/skills/nope/files/move').send({});
      expect([moved.status, moved.body]).toEqual([404, unknown]);
    });

    it('carries the detail of an unsafe path', async () => {
      const res = await request(api).put('/api/skills/getting-started/files').send({ path: '../x', content: '' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Unsafe file path "../x"',
        detail: 'paths must stay within the skill directory',
      });
    });
  });

  describe('workspaces', () => {
    it('lists workspaces with their endpoint path and resolved count', async () => {
      const res = await request(api).get('/api/workspaces');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        {
          name: 'Examples',
          slug: 'examples',
          enabled: true,
          description: 'A starter workspace. Edit or delete it once you add your own skills.',
          skills: ['getting-started'],
          path: '/mcp/w/examples',
          resolvedCount: 1,
        },
      ]);
    });

    it('creates a workspace with a slug derived from its name', async () => {
      const res = await request(api).post('/api/workspaces').send({ name: 'Back End', skillToolMode: 'loader' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Back End',
        slug: 'back-end',
        enabled: true,
        skills: [],
        skillToolMode: 'loader',
        path: '/mcp/w/back-end',
        resolvedCount: 0,
      });
    });

    it('rejects a name that yields no valid slug', async () => {
      const res = await request(api).post('/api/workspaces').send({ name: '!!!' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Invalid workspace slug ""',
        detail: 'derive a name that yields a valid URL slug',
      });
    });

    it('answers 409 when the slug is taken', async () => {
      const res = await request(api).post('/api/workspaces').send({ name: 'Examples' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Workspace "examples" already exists' });
    });

    it('answers 404 for an unknown workspace on GET, PATCH and DELETE', async () => {
      const unknown = { error: 'Unknown workspace "nope"' };
      const read = await request(api).get('/api/workspaces/nope');
      expect([read.status, read.body]).toEqual([404, unknown]);
      const patched = await request(api).patch('/api/workspaces/nope').send({});
      expect([patched.status, patched.body]).toEqual([404, unknown]);
      const deleted = await request(api).delete('/api/workspaces/nope');
      expect([deleted.status, deleted.body]).toEqual([404, unknown]);
    });

    it('keeps the slug on a member-only edit and moves it on a rename', async () => {
      const kept = await request(api).patch('/api/workspaces/examples').send({ skills: [] });
      expect(kept.status).toBe(200);
      expect(kept.body).toMatchObject({ slug: 'examples', skills: [], resolvedCount: 0 });

      const renamed = await request(api).patch('/api/workspaces/examples').send({ name: 'Starter Kit' });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ name: 'Starter Kit', slug: 'starter-kit', path: '/mcp/w/starter-kit' });
      expect((await request(api).get('/api/workspaces/examples')).status).toBe(404);
    });

    it('answers 409 when a rename collides with another workspace', async () => {
      await request(api).post('/api/workspaces').send({ name: 'Other' });
      const res = await request(api).patch('/api/workspaces/other').send({ name: 'Examples' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Workspace "examples" already exists' });
    });

    it('sets a skill-tool mode override and clears it with null', async () => {
      const set = await request(api).patch('/api/workspaces/examples').send({ skillToolMode: 'loader' });
      expect(set.body.skillToolMode).toBe('loader');
      const untouched = await request(api).patch('/api/workspaces/examples').send({ enabled: false });
      expect(untouched.body).toMatchObject({ skillToolMode: 'loader', enabled: false });
      const cleared = await request(api).patch('/api/workspaces/examples').send({ skillToolMode: null });
      expect(cleared.body).not.toHaveProperty('skillToolMode');
    });

    it('deletes a workspace with 204', async () => {
      expect((await request(api).delete('/api/workspaces/examples')).status).toBe(204);
      expect((await request(api).get('/api/workspaces')).body).toEqual([]);
    });
  });
});
