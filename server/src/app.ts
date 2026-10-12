import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { errorMiddleware } from './api/error-middleware.ts';
import { createApiRouter } from './api/router.ts';
import { createAuthMiddleware, resolveAuth } from './auth.ts';
import type { ConfigStore } from './config/store.ts';
import { BODY_LIMIT } from './core/defaults.ts';
import { createMcpRouter } from './gateway/routes.ts';
import type { McpSessionManager } from './gateway/session-manager.ts';

/** What the HTTP app needs to be built. */
export interface AppDeps {
  store: ConfigStore;
  /** The port the server will listen on; reported via GET /api/status. */
  port: number;
  /** Holds the stateful MCP sessions, so the caller can close them on shutdown. */
  sessions?: McpSessionManager;
  /** Override for tests; defaults to <repo>/app/dist. */
  appDistDir?: string;
}

/** Build the Express app (separate from listen() so tests can drive it with supertest). */
export function buildApp(deps: AppDeps): express.Express {
  const { store, port } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: BODY_LIMIT }));

  const auth = createAuthMiddleware(() => resolveAuth(store.getSettings()));

  app.use('/api', auth, createApiRouter({ store, port }));
  app.use('/mcp', auth, createMcpRouter({ store, sessions: deps.sessions }));

  // Production: serve the built web UI with an SPA fallback for non-API GETs.
  const appDist = deps.appDistDir ?? path.resolve(import.meta.dirname, '../../app/dist');
  if (existsSync(appDist)) {
    app.use(express.static(appDist));
    app.use((req, res, next) => {
      const isBackendPath = req.path.startsWith('/api') || req.path.startsWith('/mcp');
      if (req.method === 'GET' && isBackendPath === false) {
        res.sendFile(path.join(appDist, 'index.html'));
        return;
      }
      next();
    });
  }

  app.use(errorMiddleware);
  return app;
}
