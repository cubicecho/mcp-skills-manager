#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigStore } from './config/store.ts';
import { errorMessage } from './errors.ts';
import { createSkillServer } from './gateway/skill-server.ts';

/**
 * stdio MCP entry point. Serves every skill by default, or only a profile's
 * skills with `--profile <slug>`. Skills are read from DATA_DIR (default
 * ./data) and the store watches for on-disk edits so tools/list stays current
 * within a long-lived session.
 *
 *   mcp-skills-stdio --data-dir /path/to/data --profile backend
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string', short: 'p' },
      'data-dir': { type: 'string', short: 'd' },
    },
  });

  const dataDir = path.resolve(values['data-dir'] ?? process.env.DATA_DIR ?? './data');
  const store = new ConfigStore(dataDir);
  await store.init();
  store.startWatching();

  const profileSlug = values.profile;
  if (profileSlug && !store.getProfile(profileSlug)) {
    console.error(`Unknown profile "${profileSlug}" (data dir: ${dataDir})`);
    process.exit(1);
  }

  const getSkills = profileSlug
    ? () => {
        const profile = store.getProfile(profileSlug);
        return profile ? store.getSkillsForProfile(profile) : [];
      }
    : () => store.getGlobalSkills();

  const server = createSkillServer({
    label: profileSlug ?? 'all',
    getSkills,
    authoring: { store, profileSlug },
    // Mirror the HTTP profile route: a --profile endpoint honors that profile's
    // skillToolMode override, falling back to the global default.
    getSkillToolMode: () => {
      if (!profileSlug) {
        return store.getSkillToolMode();
      }
      const profile = store.getProfile(profileSlug);
      return profile ? store.getSkillToolModeForProfile(profile) : store.getSkillToolMode();
    },
    readSupportingFile: (name, relPath) => store.readSupportingFile(name, relPath),
    onSkillLoaded: (name) => store.recordSkillUse(name),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr — stdout is the MCP transport channel and must stay clean.
  console.error(
    `mcp-skills-manager stdio ready: serving ${getSkills().length} skill(s)` +
      `${profileSlug ? ` from profile "${profileSlug}"` : ''} (data dir: ${dataDir})`,
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
