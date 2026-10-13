import { HttpStatus } from '@mcp-skills/shared';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
import { sendError } from '../errors.ts';
import { closeQuietly } from './close-quietly.ts';
import { endpointDeps } from './endpoint.ts';
import { McpSessionManager } from './session-manager.ts';
import { createSkillServer } from './skill-server.ts';

/** What the MCP endpoints need from the process that mounts them. */
export interface McpRouterDeps {
  /** The store the endpoints serve skills from. */
  store: ConfigStore;
  /** Holds the stateful sessions; pass one to be able to close them on shutdown. */
  sessions?: McpSessionManager;
}

/**
 * Builds the Streamable-HTTP MCP endpoints: `/` serves every global skill, `/w/:slug` one enabled workspace's.
 *
 * @param deps - The store, and optionally the session manager that holds the stateful sessions.
 * @returns The router to mount.
 *
 * @remarks
 * Stateless unless `settings.httpLiveUpdates` is on: a fresh skill server and transport per request, closed with
 * the response. With it on, requests go through {@link McpSessionManager}, whose persistent sessions can push
 * notifications over SSE. The setting is read on every request, so a change needs no restart.
 */
export function createMcpRouter(deps: McpRouterDeps): Router {
  const { store } = deps;
  const router = Router();
  const sessions = deps.sessions ?? new McpSessionManager();

  // Stateless path: fresh server + transport per request, cleaned up on close.
  const handleStateless = async (req: Request, res: Response, buildServer: () => Server): Promise<void> => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void closeQuietly(transport, 'MCP transport');
      void closeQuietly(server, 'MCP server');
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  // Dispatches per the live setting. Only a stateful session is built with live updates, so a
  // stateless server never advertises capabilities it can't honor.
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
    if (isServed === false) {
      sendError(res, HttpStatus.NotFound, `Unknown workspace "${slug}"`);
      return;
    }
    await handle(req, res, slug);
  });

  return router;
}
