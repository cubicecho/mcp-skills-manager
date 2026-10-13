#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigStore } from './config/store.ts';
import { EnvVar } from './core/defaults.ts';
import { errorMessage } from './errors.ts';
import { endpointDeps } from './gateway/endpoint.ts';
import { createSkillServer } from './gateway/skill-server.ts';
import { closeOnSignal } from './shutdown.ts';

/**
 * Runs the stdio MCP server: `mcp-skills-stdio --data-dir /path/to/data --workspace backend`.
 *
 * @remarks
 * It serves the root endpoint's skills, or only a workspace's with `--workspace <slug>`; an unknown slug
 * exits 1. Skills are read from `--data-dir`, else `DATA_DIR`, else `./data`. The store watches for
 * on-disk edits, so tools/list stays current within a long-lived session.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string', short: 'w' },
      'data-dir': { type: 'string', short: 'd' },
    },
  });

  const dataDir = path.resolve(values['data-dir'] ?? process.env[EnvVar.DataDir] ?? './data');
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

  closeOnSignal(
    [
      { label: 'MCP server', close: () => server.close() },
      { label: 'store', close: () => store.close() },
    ],
    { on: (signal, listener) => process.on(signal, listener), exit: (code) => process.exit(code), log: console.error },
  );
}

main().catch((err: unknown) => {
  console.error(`Fatal stdio startup error: ${errorMessage(err)}`);
  process.exit(1);
});
