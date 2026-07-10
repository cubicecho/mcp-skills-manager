import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
import { errorMessage } from '../errors.ts';
import { McpSessionManager } from './session-manager.ts';
import { createSkillServer, type SkillServerDeps } from './skill-server.ts';

export interface McpRouterDeps {
  store: ConfigStore;
}

/**
 * Streamable-HTTP MCP endpoints:
 *
 *  - `/`            → every skill
 *  - `/p/:slug`     → only the skills in that profile
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

  // Wire the store's `change` event so a stateful session pushes notifications
  // when skills are edited on disk (the same hook stdio uses). Only attached to
  // sessions built in live-updates mode.
  const onSkillsChanged: SkillServerDeps['onSkillsChanged'] = (listener) => {
    store.on('change', listener);
    return () => store.off('change', listener);
  };

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
  // setting. `buildServer(live)` wires `onSkillsChanged` only when live so a
  // stateless server never advertises capabilities it can't honor.
  const handle = async (req: Request, res: Response, buildServer: (live: boolean) => Server): Promise<void> => {
    if (store.isHttpLiveUpdates()) {
      await sessions.handle(req, res, () => buildServer(true));
    } else {
      await handleStateless(req, res, () => buildServer(false));
    }
  };

  // Root aggregate: every globally-visible skill (skills flagged `global: false` are profile-only).
  router.all('/', async (req, res) => {
    await handle(req, res, (live) =>
      createSkillServer({
        label: 'all',
        getSkills: () => store.getGlobalSkills(),
        authoring: { store },
        getSkillToolMode: () => store.getSkillToolMode(),
        readSupportingFile: (name, relPath) => store.readSupportingFile(name, relPath),
        onSkillLoaded: (name) => store.recordSkillUse(name),
        ...(live ? { onSkillsChanged } : {}),
      }),
    );
  });

  // Profile-filtered aggregate. Registered before nothing else is needed here,
  // but kept distinct from the root so `/mcp` and `/mcp/p/<slug>` never collide.
  router.all('/p/:slug', async (req, res) => {
    const slug = req.params.slug;
    const profile = store.getProfile(slug);
    if (!profile || !profile.enabled) {
      res.status(404).json({ error: `Unknown profile "${slug}"` });
      return;
    }
    await handle(req, res, (live) =>
      createSkillServer({
        label: slug,
        getSkills: () => {
          const current = store.getProfile(slug);
          return current ? store.getSkillsForProfile(current) : [];
        },
        // Skills authored via this endpoint are scoped to the profile (global:false + added to it).
        authoring: { store, profileSlug: slug },
        // Resolve the profile's own mode override (falling back to the global default) fresh per request.
        getSkillToolMode: () => {
          const current = store.getProfile(slug);
          return current ? store.getSkillToolModeForProfile(current) : store.getSkillToolMode();
        },
        readSupportingFile: (name, relPath) => store.readSupportingFile(name, relPath),
        onSkillLoaded: (name) => store.recordSkillUse(name),
        ...(live ? { onSkillsChanged } : {}),
      }),
    );
  });

  return router;
}
