import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
import { errorMessage } from '../errors.ts';
import { endpointDeps } from './endpoint.ts';
import { McpSessionManager } from './session-manager.ts';
import { createSkillServer } from './skill-server.ts';

/** What the MCP endpoints need from the process that mounts them. */
export interface McpRouterDeps {
  store: ConfigStore;
}

/**
 * Streamable-HTTP MCP endpoints:
 *
 *  - `/`            → every skill
 *  - `/w/:slug`     → only the skills in that workspace
 *
 * Stateless by default (a fresh skill `Server` + transport per request, torn
 * down on response close). When `settings.httpLiveUpdates` is on, requests are
 * routed through {@link McpSessionManager} instead — persistent sessions that
 * can push `resources/list_changed` + `updated` over SSE. The mode is read fresh
 * per request, so toggling the setting takes effect without a restart.
 */
export function createMcpRouter(deps: McpRouterDeps): Router {
  const { store } = deps;
  const router = Router();
  const sessions = new McpSessionManager();

  // Stateless path: fresh server + transport per request, cleaned up on close.
  const handleStateless = async (req: Request, res: Response, buildServer: () => Server): Promise<void> => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close().catch((err: unknown) => console.warn(`MCP transport close failed: ${errorMessage(err)}`));
      server.close().catch((err: unknown) => console.warn(`MCP server close failed: ${errorMessage(err)}`));
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  // Dispatch to the stateful session manager or the stateless path per the live
  // setting. Only a stateful session is built with live updates, so a stateless
  // server never advertises capabilities it can't honor.
  const handle = async (req: Request, res: Response, workspaceSlug: string | undefined): Promise<void> => {
    const buildServer = (liveUpdates: boolean): Server =>
      createSkillServer(endpointDeps(store, { workspaceSlug, liveUpdates }));
    if (store.isHttpLiveUpdates()) {
      await sessions.handle(req, res, () => buildServer(true));
    } else {
      await handleStateless(req, res, () => buildServer(false));
    }
  };

  // Root aggregate: every globally-visible skill.
  router.all('/', async (req, res) => {
    await handle(req, res, undefined);
  });

  // Workspace-filtered aggregate: only the skills of an enabled workspace.
  router.all('/w/:slug', async (req, res) => {
    const slug = req.params.slug;
    const workspace = store.getWorkspace(slug);
    const isServed = workspace?.enabled === true;
    if (!isServed) {
      res.status(404).json({ error: `Unknown workspace "${slug}"` });
      return;
    }
    await handle(req, res, slug);
  });

  return router;
}
