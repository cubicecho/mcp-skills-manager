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
  /** The store the API and MCP routes read and write. */
  store: ConfigStore;
  /** The port the server will listen on; reported via GET /api/status. */
  port: number;
  /** Holds the stateful MCP sessions, so the caller can close them on shutdown. */
  sessions?: McpSessionManager;
  /**
   * Directory holding the built web UI, served only when it exists; tests override it.
   *
   * @defaultValue `<repo>/app/dist`
   */
  appDistDir?: string;
}

/**
 * Builds the Express app: /api and /mcp behind bearer auth, then the built web UI with an SPA fallback.
 *
 * @param deps - The store, the listening port, and optionally the session manager and web UI directory.
 * @returns The app, not yet listening, so tests can drive it with supertest.
 */
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
