import path from 'node:path';
import { cardConnection, parseAiCatalog, parseServerCard } from '@cubicecho/mcp-discovery';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { useTempStore } from '../test/temp-store.ts';
import { discoveryEndpoints } from './endpoints.ts';

describe('discovery documents', () => {
  const temp = useTempStore();

  /**
   * Builds the full app, auth guard included, over the test's store.
   * @returns The app, ready for supertest.
   */
  function app() {
    return buildApp({ store: temp.store, port: 4321, appDistDir: path.join(temp.dir, 'no-app') });
  }

  it('serves the catalog without a token while /mcp still asks for one', async () => {
    const catalog = await request(app()).get('/.well-known/ai-catalog.json');
    expect(catalog.status).toBe(200);
    expect(catalog.headers['content-type']).toContain('application/ai-catalog+json');
    expect((await request(app()).post('/mcp').send({})).status).toBe(401);
  });

  it('lists /mcp and every enabled workspace, each with a card on the address the client used', async () => {
    await temp.store.saveWorkspace({ name: 'Backend', slug: 'backend', enabled: true, skills: [] });
    await temp.store.saveWorkspace({ name: 'Off', slug: 'off', enabled: false, skills: [] });

    const catalog = parseAiCatalog((await request(app()).get('/.well-known/ai-catalog.json')).body, 'test');
    const cardUrls = catalog.entries.map((entry) => entry.url ?? '');
    const paths = cardUrls.map((url) => new URL(url).pathname);
    expect(paths[0]).toBe('/mcp/server-card');
    expect(paths).toContain('/mcp/w/backend/server-card');
    expect(paths).not.toContain('/mcp/w/off/server-card');

    const cardResponse = await request(app()).get('/mcp/w/backend/server-card').set('Host', 'nas.local:4321');
    const card = parseServerCard(cardResponse.body, 'test');
    expect(card.title).toBe('Backend');
    expect(cardConnection(card)).toEqual({
      url: 'http://nas.local:4321/mcp/w/backend',
      requiredHeaders: ['Authorization'],
    });
  });

  it('asks for no token when auth is off', async () => {
    await temp.store.updateSettings({ authEnabled: false });
    const card = parseServerCard((await request(app()).get('/mcp/server-card')).body, 'test');
    expect(cardConnection(card)?.requiredHeaders).toEqual([]);
  });

  it('does not serve a card for a disabled workspace', async () => {
    await temp.store.saveWorkspace({ name: 'Off', slug: 'off', enabled: false, skills: [] });
    expect((await request(app()).get('/mcp/w/off/server-card')).status).toBe(401);
  });

  it('names cards after the host, so two servers on one network stay apart', () => {
    const [root] = discoveryEndpoints(temp.store, 'NAS.lan');
    expect(root?.identifier).toBe('urn:air:nas.mcp-skills:mcp:skills');
  });
});
