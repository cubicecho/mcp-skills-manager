import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.ts';
import { createAuthMiddleware } from './auth.ts';
import { ConfigStore } from './config/store.ts';

describe('bearer auth', () => {
  let dir: string;
  let store: ConfigStore;

  /**
   * Starts a store on the temp data dir and builds the full app on it.
   * @returns The app, ready for supertest.
   */
  async function startApp(): Promise<express.Express> {
    store = new ConfigStore(dir);
    await store.init();
    return buildApp({ store, port: 4321, appDistDir: path.join(dir, 'no-app') });
  }

  /**
   * Reads the token persisted in settings.json.
   * @returns The token, or null when none is stored.
   */
  async function storedToken(): Promise<string | null> {
    const raw = await readFile(path.join(dir, 'config/settings.json'), 'utf8');
    return (JSON.parse(raw) as { authToken: string | null }).authToken;
  }

  beforeEach(async () => {
    vi.stubEnv('SECURE_LOCAL_NET', '');
    vi.stubEnv('MCP_SKILLS_TOKEN', undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-auth-'));
  });

  afterEach(async () => {
    await store?.close();
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses /api and /mcp without the token and accepts them with it', async () => {
    const app = await startApp();
    const token = store.getSettings().authToken ?? '';
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const missing = await request(app).get('/api/status');
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ error: 'Unauthorized' });
    expect((await request(app).get('/api/status').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await request(app).get('/api/status').set('Authorization', `Basic ${token}`)).status).toBe(401);
    expect((await request(app).post('/mcp').send({})).status).toBe(401);

    expect((await request(app).get('/api/status').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).get('/api/status').set('Authorization', `bearer ${token}`)).status).toBe(200);
  });

  it('lets every request through when SECURE_LOCAL_NET is on', async () => {
    vi.stubEnv('SECURE_LOCAL_NET', 'true');
    const app = await startApp();
    expect((await request(app).get('/api/status')).status).toBe(200);
    expect(await storedToken()).toBeNull();
  });

  it('takes the token from MCP_SKILLS_TOKEN over the one in settings.json', async () => {
    await startApp();
    const fromSettings = store.getSettings().authToken ?? '';
    await store.close();

    vi.stubEnv('MCP_SKILLS_TOKEN', 'from-env');
    const app = await startApp();
    expect((await request(app).get('/api/status').set('Authorization', 'Bearer from-env')).status).toBe(200);
    expect((await request(app).get('/api/status').set('Authorization', `Bearer ${fromSettings}`)).status).toBe(401);
  });

  it('generates no token when MCP_SKILLS_TOKEN supplies one', async () => {
    vi.stubEnv('MCP_SKILLS_TOKEN', 'from-env');
    await startApp();
    expect(await storedToken()).toBeNull();
  });

  it('generates the token once, keeping it across reloads and restarts', async () => {
    await startApp();
    const first = await storedToken();
    await store.reload();
    expect(await storedToken()).toBe(first);
    await store.close();
    await startApp();
    expect(store.getSettings().authToken).toBe(first);
  });

  it('writes settings.json readable by its owner only', async () => {
    await startApp();
    const { mode } = await stat(path.join(dir, 'config/settings.json'));
    expect(mode & 0o777).toBe(0o600);
  });

  it('refuses every request when auth is on and there is no token to match', async () => {
    const guard = createAuthMiddleware(() => ({ enabled: true, token: null }));
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const next = vi.fn();
    guard({ headers: { authorization: 'Bearer anything' } } as never, { status } as never, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Auth is enabled but no token is configured' });
    expect(next).not.toHaveBeenCalled();
  });
});
