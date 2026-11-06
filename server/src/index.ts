import { hostname } from 'node:os';
import path from 'node:path';
import { createAdvertiser } from '@cubicecho/mcp-discovery/mdns';
import { buildApp } from './app.ts';
import { authDisabledByEnv, resolveAuth } from './auth.ts';
import { ConfigStore } from './config/store.ts';
import { EnvVar } from './core/defaults.ts';
import { McpSessionManager } from './gateway/session-manager.ts';
import { resolvePort, tuneKeepAlive } from './http-tuning.ts';
import { closeOnSignal } from './shutdown.ts';

/**
 * Starts the HTTP server: loads and watches the store, listens, and closes everything on SIGTERM or SIGINT.
 *
 * @remarks
 * The data dir is `DATA_DIR`, else `./data`. A port already in use ends the process with exit code 1.
 */
async function main(): Promise<void> {
  const dataDir = path.resolve(process.env[EnvVar.DataDir] ?? './data');
  const store = new ConfigStore(dataDir);
  await store.init();

  const port = resolvePort(store.getSettings().port);
  const advertiser = createAdvertiser({
    isWanted: () => store.getSettings().lanAdvertise,
    options: () => ({ name: `MCP Skills on ${hostname()}`, port }),
    log: console.log,
  });

  store.on('change', (state) => {
    console.log(`Config changed on disk: ${state.skills.length} skills, ${state.workspaces.length} workspaces`);
    // A toggle in the UI writes settings.json, so it arrives here like a hand edit.
    void advertiser.sync();
  });
  store.startWatching();

  const sessions = new McpSessionManager();
  const app = buildApp({ store, port, sessions });
  const httpServer = app.listen(port, () => {
    console.log(`mcp-skills-manager listening on http://localhost:${port} (data dir: ${dataDir})`);
    const settings = store.getSettings();
    const auth = resolveAuth(settings);
    if (authDisabledByEnv()) {
      console.log('Auth: disabled (SECURE_LOCAL_NET env var) — /api and /mcp are open on this network');
    } else if (!settings.authEnabled) {
      console.log('Auth: disabled (authEnabled: false in settings.json)');
    } else if (auth.tokenSource === 'env') {
      console.log('Auth: bearer token from MCP_SKILLS_TOKEN env var (overrides settings.json)');
    } else {
      console.log(`Auth: bearer token from ${path.join(dataDir, 'config/settings.json')}`);
    }
    // After listen, so a router that finds the announcement can already read the catalog.
    void advertiser.sync();
  });

  tuneKeepAlive(httpServer);

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${port} is already in use by another process. ` +
          'Set PORT (or the "port" field in settings.json) to a free port and restart.',
      );
    } else {
      // Thrown from here it would surface as an uncaught exception, with a stack in place of the reason.
      console.error(`The HTTP server failed: ${err.message}`);
    }
    process.exit(1);
  });

  closeOnSignal(
    [
      // First, so the goodbye goes out while the server can still answer.
      { label: 'LAN advertisement', close: () => advertiser.close() },
      // Not awaited: it only settles once every connection has ended, and the sessions hold theirs open.
      { label: 'HTTP server', close: () => void httpServer.close() },
      { label: 'MCP sessions', close: () => sessions.closeAll() },
      { label: 'store', close: () => store.close() },
    ],
    { on: (signal, listener) => process.on(signal, listener), exit: (code) => process.exit(code), log: console.log },
  );
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
