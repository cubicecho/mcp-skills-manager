import path from 'node:path';
import { buildApp } from './app.ts';
import { authDisabledByEnv } from './auth.ts';
import { ConfigStore } from './config/store.ts';

async function main(): Promise<void> {
  const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
  const store = new ConfigStore(dataDir);
  await store.init();

  store.on('change', (state) => {
    console.log(`Config changed on disk: ${state.skills.length} skills, ${state.profiles.length} profiles`);
  });
  store.startWatching();

  const port = Number(process.env.PORT ?? store.getSettings().port);
  const app = buildApp({ store, port });
  const httpServer = app.listen(port, () => {
    console.log(`mcp-skills-manager listening on http://localhost:${port} (data dir: ${dataDir})`);
    const settings = store.getSettings();
    if (authDisabledByEnv()) {
      console.log('Auth: disabled (SECURE_LOCAL_NET env var) — /api and /mcp are open on this network');
    } else if (!settings.authEnabled) {
      console.log('Auth: disabled (authEnabled: false in settings.json)');
    } else if (process.env.MCP_SKILLS_TOKEN) {
      console.log('Auth: bearer token from MCP_SKILLS_TOKEN env var (overrides settings.json)');
    } else {
      console.log(`Auth: bearer token from ${path.join(dataDir, 'config/settings.json')}:\n  ${settings.authToken}`);
    }
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${port} is already in use by another process. ` +
          'Set PORT (or the "port" field in settings.json) to a free port and restart.',
      );
      process.exit(1);
    }
    throw err;
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down`);
    httpServer.close();
    store.close().then(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
