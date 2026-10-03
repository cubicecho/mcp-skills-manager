#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigStore } from './config/store.ts';
import { errorMessage } from './errors.ts';
import { endpointDeps } from './gateway/endpoint.ts';
import { createSkillServer } from './gateway/skill-server.ts';

/**
 * stdio MCP entry point. Serves every skill by default, or only a workspace's
 * skills with `--workspace <slug>`. Skills are read from DATA_DIR (default
 * ./data) and the store watches for on-disk edits so tools/list stays current
 * within a long-lived session.
 *
 *   mcp-skills-stdio --data-dir /path/to/data --workspace backend
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string', short: 'w' },
      'data-dir': { type: 'string', short: 'd' },
    },
  });

  const dataDir = path.resolve(values['data-dir'] ?? process.env.DATA_DIR ?? './data');
  const store = new ConfigStore(dataDir);
  await store.init();
  store.startWatching();

  const workspaceSlug = values.workspace;
  if (workspaceSlug && !store.getWorkspace(workspaceSlug)) {
    console.error(`Unknown workspace "${workspaceSlug}" (data dir: ${dataDir})`);
    process.exit(1);
  }

  // stdio is a long-lived transport, so it can push live updates. (The stateless HTTP route cannot.)
  const deps = endpointDeps(store, { workspaceSlug, liveUpdates: true });
  const server = createSkillServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr — stdout is the MCP transport channel and must stay clean.
  console.error(
    `mcp-skills-manager stdio ready: serving ${deps.getSkills().length} skill(s)` +
      `${workspaceSlug ? ` from workspace "${workspaceSlug}"` : ''} (data dir: ${dataDir})`,
  );

  const shutdown = () => {
    store
      .close()
      .catch((err: unknown) => console.error(`Shutdown error: ${errorMessage(err)}`))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error(`Fatal stdio startup error: ${errorMessage(err)}`);
  process.exit(1);
});
