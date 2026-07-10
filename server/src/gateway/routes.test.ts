import { mkdtemp, rm } from 'node:fs/promises';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config/store.ts';
import { createMcpRouter } from './routes.ts';

/**
 * Boots the MCP router on a real (ephemeral-port) HTTP server so we can drive it
 * with the SDK's Streamable-HTTP client — the only way to exercise the stateful
 * session + SSE push path end to end. Auth is left off (bare express).
 */
async function boot(store: ConfigStore): Promise<{ url: URL; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/mcp', createMcpRouter({ store }));
  const httpServer: HttpServer = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = httpServer.address() as AddressInfo;
  return {
    url: new URL(`http://127.0.0.1:${port}/mcp`),
    close: () =>
      new Promise<void>((resolve) => {
        // Force-destroy any lingering SSE sockets so close() can't hang on them.
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
      }),
  };
}

/** Poll a predicate until true (or throw after ~1s) — for observing async server-side teardown. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('waitFor timed out');
}

/** Connect an SDK client over Streamable HTTP and return it plus its transport (for sessionId). */
async function connect(url: URL): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

describe('MCP HTTP router', () => {
  let dir: string;
  let store: ConfigStore;
  let server: { url: URL; close: () => Promise<void> };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-routes-'));
    store = new ConfigStore(dir);
    await store.init(); // seeds a getting-started skill
  });

  afterEach(async () => {
    await server?.close();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  describe('stateless (default)', () => {
    it('serves without a session id and advertises no live-update capabilities', async () => {
      server = await boot(store);
      const { client, transport } = await connect(server.url);
      // Stateless: the server never mints an Mcp-Session-Id.
      expect(transport.sessionId).toBeUndefined();
      expect(client.getServerCapabilities()?.resources).toEqual({});
      // Skills are still fully served — this is only about push, not content.
      expect((await client.listResources()).resources.length).toBeGreaterThan(0);
      await client.close();
    });
  });

  describe('stateful (httpLiveUpdates)', () => {
    beforeEach(async () => {
      await store.updateSettings({ httpLiveUpdates: true });
    });

    it('mints a session id and advertises listChanged + subscribe', async () => {
      server = await boot(store);
      const { client, transport } = await connect(server.url);
      expect(transport.sessionId).toBeDefined();
      expect(client.getServerCapabilities()?.resources).toMatchObject({ listChanged: true, subscribe: true });
      await client.close();
    });

    it('pushes list_changed + resources/updated over SSE when the store changes', async () => {
      server = await boot(store);
      const { client } = await connect(server.url);

      let listChanged = 0;
      const updated: string[] = [];
      client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
        listChanged += 1;
      });
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (n) => {
        updated.push(n.params.uri);
      });

      const first = (await client.listResources()).resources[0];
      if (!first) throw new Error('expected at least one resource');
      await client.subscribeResource({ uri: first.uri });

      // Simulate the watcher firing after an on-disk edit.
      store.emit('change', store.snapshot());
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(listChanged).toBe(1);
      expect(updated).toEqual([first.uri]);
      await client.close();
    });

    it('reclaims the session (and its store listener) when the client disconnects', async () => {
      server = await boot(store);
      expect(store.listenerCount('change')).toBe(0);

      const { client } = await connect(server.url);
      // A live session holds exactly one `change` listener (for its SSE push).
      expect(store.listenerCount('change')).toBe(1);

      // Prove the standalone SSE stream is actually up before we drop it: a pushed
      // notification can only arrive over that stream. The SDK opens it fire-and-
      // forget after `initialized`, so it is NOT guaranteed live the instant
      // connect() resolves — waiting on a real push makes the teardown deterministic.
      let pushed = false;
      client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
        pushed = true;
      });
      // Nudge repeatedly until a push actually lands: an emit before the SSE stream
      // is live is simply dropped, so retrying makes the "stream is up" wait robust.
      await waitFor(() => {
        store.emit('change', store.snapshot());
        return pushed;
      });

      // client.close() aborts that SSE stream WITHOUT sending a DELETE. The server
      // sees the stream close and reclaims the session — no leaked store listener.
      await client.close();
      await waitFor(() => store.listenerCount('change') === 0);
    });

    it('rejects a request carrying an unknown session id with 404', async () => {
      server = await boot(store);
      const res = await fetch(server.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': 'does-not-exist',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      expect(res.status).toBe(404);
    });
  });
});
