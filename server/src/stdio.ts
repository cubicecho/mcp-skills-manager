#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigStore } from './config/store.ts';
import { errorMessage } from './errors.ts';
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

  const getSkills = workspaceSlug
    ? () => {
        const workspace = store.getWorkspace(workspaceSlug);
        return workspace ? store.getSkillsForWorkspace(workspace) : [];
      }
    : () => store.getGlobalSkills();

  const server = createSkillServer({
    label: workspaceSlug ?? 'all',
    getSkills,
    authoring: { store, workspaceSlug },
    // Mirror the HTTP workspace route: a --workspace endpoint honors that workspace's
    // skillToolMode override, falling back to the global default.
    getSkillToolMode: () => {
      if (!workspaceSlug) {
        return store.getSkillToolMode();
      }
      const workspace = store.getWorkspace(workspaceSlug);
      return workspace ? store.getSkillToolModeForWorkspace(workspace) : store.getSkillToolMode();
    },
    readSupportingFile: (name, relPath) => store.readSupportingFile(name, relPath),
    onSkillLoaded: (name) => store.recordSkillUse(name),
    // Long-lived transport: push resources/list_changed + updated when the store
    // reloads after an on-disk edit. (The stateless HTTP route omits this.)
    onSkillsChanged: (listener) => {
      store.on('change', listener);
      return () => store.off('change', listener);
    },
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr — stdout is the MCP transport channel and must stay clean.
  console.error(
    `mcp-skills-manager stdio ready: serving ${getSkills().length} skill(s)` +
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
