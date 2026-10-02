import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_KEEP_ALIVE_TIMEOUT_MS, tuneKeepAlive } from './http-tuning.ts';

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

describe('tuneKeepAlive', () => {
  it('raises keepAliveTimeout above the Node default', () => {
    const server = createServer();
    expect(tuneKeepAlive(server, {})).toBe(DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBe(DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
  });

  it('takes HTTP_KEEP_ALIVE_TIMEOUT_MS, including 0 for no timeout', () => {
    const server = createServer();
    expect(tuneKeepAlive(server, { HTTP_KEEP_ALIVE_TIMEOUT_MS: '120000' })).toBe(120_000);
    expect(server.keepAliveTimeout).toBe(120_000);
    expect(tuneKeepAlive(server, { HTTP_KEEP_ALIVE_TIMEOUT_MS: '0' })).toBe(0);
  });

  it.each(['', 'soon', '-1', '1.5'])('falls back to the default for %j', (value) => {
    expect(tuneKeepAlive(createServer(), { HTTP_KEEP_ALIVE_TIMEOUT_MS: value })).toBe(DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
  });

  it('tells clients how long the connection is kept', async () => {
    const server = createServer((_req, res) => {
      res.end('{}');
    });
    servers.push(server);
    tuneKeepAlive(server, {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await response.text();
    expect(response.headers.get('keep-alive')).toBe(`timeout=${DEFAULT_KEEP_ALIVE_TIMEOUT_MS / 1000}`);
  });
});
