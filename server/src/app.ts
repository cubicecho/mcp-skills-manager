import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { errorMiddleware } from './api/error-middleware.ts';
import { createApiRouter } from './api/router.ts';
import { authDisabledByEnv, createAuthMiddleware } from './auth.ts';
import type { ConfigStore } from './config/store.ts';
import { createMcpRouter } from './gateway/routes.ts';

export interface AppDeps {
  store: ConfigStore;
  /** Override for tests; defaults to <repo>/app/dist. */
  appDistDir?: string;
}

/** Build the Express app (separate from listen() so tests can drive it with supertest). */
export function buildApp(deps: AppDeps): express.Express {
  const { store } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));

  const auth = createAuthMiddleware(() => {
    const settings = store.getSettings();
    return {
      enabled: settings.authEnabled && !authDisabledByEnv(),
      token: process.env.MCP_SKILLS_TOKEN ?? settings.authToken,
    };
  });

  app.use('/api', auth, createApiRouter({ store }));
  app.use('/mcp', auth, createMcpRouter({ store }));

  // Production: serve the built web UI with an SPA fallback for non-API GETs.
  const appDist = deps.appDistDir ?? path.resolve(import.meta.dirname, '../../app/dist');
  if (existsSync(appDist)) {
    app.use(express.static(appDist));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/mcp')) {
        res.sendFile(path.join(appDist, 'index.html'));
        return;
      }
      next();
    });
  }

  app.use(errorMiddleware);
  return app;
}
