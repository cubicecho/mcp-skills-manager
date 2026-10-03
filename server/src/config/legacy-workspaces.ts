import { existsSync } from 'node:fs';
import { readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { workspaceConfigSchema } from '@mcp-skills/shared';

/**
 * One-time migration: "profiles" were renamed to "workspaces", including their
 * on-disk config directory (`config/profiles` → `config/workspaces`). If an
 * install still has the legacy `config/profiles` dir, move each `*.json` into
 * `config/workspaces` (without clobbering a file already there) and remove the
 * emptied legacy dir. Safe to run every startup — it no-ops once migrated.
 * @param configDir - Absolute path of the config dir that may hold `profiles`.
 * @param workspacesDir - Absolute path of the `config/workspaces` dir to move into.
 */
export async function migrateLegacyWorkspaces(configDir: string, workspacesDir: string): Promise<void> {
  const legacyDir = path.join(configDir, 'profiles');
  if (!existsSync(legacyDir)) {
    return;
  }
  const files = (await readdir(legacyDir)).filter((f) => f.endsWith('.json'));
  let moved = 0;
  // Sort for a deterministic winner when two legacy files resolve to the same slug.
  for (const file of files.sort()) {
    const source = path.join(legacyDir, file);
    // Migrate to the file's canonical `<slug>.json` name so the collision check
    // is by workspace identity (slug), not by a possibly hand-edited filename —
    // loadWorkspaces keys by the declared slug, so a mismatched filename could
    // otherwise slip past and overwrite an existing workspace on load.
    const target = path.join(workspacesDir, await legacyWorkspaceTargetName(source, file));
    if (existsSync(target)) {
      continue; // a workspace with this slug already exists; leave the legacy copy in place
    }
    await rename(source, target);
    moved += 1;
  }
  // Drop the legacy dir once no workspace files remain in it; stray non-.json
  // entries (e.g. .DS_Store) are ours to clear out along with the dir.
  if ((await readdir(legacyDir)).filter((f) => f.endsWith('.json')).length === 0) {
    await rm(legacyDir, { recursive: true, force: true });
  }
  if (moved > 0) {
    console.log(`Migrated ${moved} profile config file(s) to config/workspaces.`);
  }
}

/**
 * Pick the destination file name for a legacy profile file. A bad entry (an
 * unreadable file, or a `.json`-named directory) keeps its original name, so it
 * is never lost and never aborts startup.
 * @param source - Absolute path of the legacy file.
 * @param fallback - The file's original name.
 * @returns The canonical `<slug>.json`, or `fallback` when no slug can be read.
 */
async function legacyWorkspaceTargetName(source: string, fallback: string): Promise<string> {
  try {
    const parsed = workspaceConfigSchema.safeParse(JSON.parse(await readFile(source, 'utf8')));
    if (parsed.success) {
      return `${parsed.data.slug}.json`;
    }
  } catch {
    // Unreadable (EISDIR/EACCES) or invalid JSON — fall through to the original filename.
  }
  return fallback;
}
