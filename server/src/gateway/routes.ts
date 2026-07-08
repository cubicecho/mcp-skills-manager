import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
import { errorMessage } from '../errors.ts';
import { createSkillServer } from './skill-server.ts';

export interface McpRouterDeps {
  store: ConfigStore;
}

/**
 * Streamable-HTTP MCP endpoints, stateless mode: a fresh skill Server +
 * transport per request, cleaned up when the response closes.
 *
 *  - `/`            → every skill
 *  - `/p/:slug`     → only the skills in that profile
 */
export function createMcpRouter(deps: McpRouterDeps): Router {
  const { store } = deps;
  const router = Router();

  const handle = async (req: Request, res: Response, buildServer: () => Server): Promise<void> => {
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

  // Root aggregate: every globally-visible skill (skills flagged `global: false` are profile-only).
  router.all('/', async (req, res) => {
    await handle(req, res, () =>
      createSkillServer({
        label: 'all',
        getSkills: () => store.getGlobalSkills(),
        authoring: { store },
        getSkillToolMode: () => store.getSkillToolMode(),
        readSupportingFile: (name, relPath) => store.readSupportingFile(name, relPath),
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
    await handle(req, res, () =>
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
      }),
    );
  });

  return router;
}
