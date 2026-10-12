import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from './store.ts';

describe('ConfigStore legacy profiles → workspaces migration', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-migrate-'));
  });

  afterEach(async () => {
    await store?.close();
    await rm(dir, { recursive: true, force: true });
  });

  const legacyWorkspace = (slug: string) =>
    Buffer.from(JSON.stringify({ name: slug, slug, enabled: true, skills: [] }));

  it('moves config/profiles/*.json into config/workspaces on init and removes the legacy dir', async () => {
    const legacyDir = path.join(dir, 'config', 'profiles');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, 'backend.json'), legacyWorkspace('backend'));

    store = new ConfigStore(dir);
    await store.init();

    expect(store.getWorkspace('backend')).toBeDefined();
    expect(existsSync(path.join(dir, 'config', 'workspaces', 'backend.json'))).toBe(true);
    expect(existsSync(legacyDir)).toBe(false);
  });

  it('does not clobber an existing workspace of the same slug and keeps the legacy file', async () => {
    const legacyDir = path.join(dir, 'config', 'profiles');
    const workspacesDir = path.join(dir, 'config', 'workspaces');
    await mkdir(legacyDir, { recursive: true });
    await mkdir(workspacesDir, { recursive: true });
    // Same slug in both places, differing content — the workspaces copy must win.
    await writeFile(
      path.join(workspacesDir, 'dup.json'),
      Buffer.from(JSON.stringify({ name: 'new', slug: 'dup', enabled: true, skills: [] })),
    );
    await writeFile(
      path.join(legacyDir, 'dup.json'),
      Buffer.from(JSON.stringify({ name: 'old', slug: 'dup', enabled: true, skills: [] })),
    );

    store = new ConfigStore(dir);
    await store.init();

    expect(store.getWorkspace('dup')?.name).toBe('new');
    // The un-migratable legacy file is left in place (dir not removed).
    expect(existsSync(path.join(legacyDir, 'dup.json'))).toBe(true);
  });

  it('detects a same-slug collision even when the legacy filename differs, and normalizes the destination name', async () => {
    const legacyDir = path.join(dir, 'config', 'profiles');
    const workspacesDir = path.join(dir, 'config', 'workspaces');
    await mkdir(legacyDir, { recursive: true });
    await mkdir(workspacesDir, { recursive: true });
    // Existing workspace with slug "backend"; legacy file has the same slug but a
    // mismatched filename, so a filename-only guard would let it through.
    await writeFile(
      path.join(workspacesDir, 'backend.json'),
      Buffer.from(JSON.stringify({ name: 'kept', slug: 'backend', enabled: true, skills: [] })),
    );
    await writeFile(
      path.join(legacyDir, 'legacy-backend.json'),
      Buffer.from(JSON.stringify({ name: 'stale', slug: 'backend', enabled: true, skills: [] })),
    );

    store = new ConfigStore(dir);
    await store.init();

    // The real workspace is preserved, not overwritten by the stale legacy copy.
    expect(store.getWorkspace('backend')?.name).toBe('kept');
    expect(existsSync(path.join(legacyDir, 'legacy-backend.json'))).toBe(true);
  });

  it('migrates a legacy file whose filename does not match its slug to its canonical <slug>.json name', async () => {
    const legacyDir = path.join(dir, 'config', 'profiles');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, 'oldname.json'), legacyWorkspace('frontend'));

    store = new ConfigStore(dir);
    await store.init();

    expect(store.getWorkspace('frontend')).toBeDefined();
    expect(existsSync(path.join(dir, 'config', 'workspaces', 'frontend.json'))).toBe(true);
    expect(existsSync(legacyDir)).toBe(false);
  });

  it('removes the legacy dir even when a stray non-.json file remains after migration', async () => {
    const legacyDir = path.join(dir, 'config', 'profiles');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, 'backend.json'), legacyWorkspace('backend'));
    await writeFile(path.join(legacyDir, '.DS_Store'), Buffer.from('junk'));

    store = new ConfigStore(dir);
    await store.init();

    expect(store.getWorkspace('backend')).toBeDefined();
    expect(existsSync(legacyDir)).toBe(false);
  });

  it('survives an unreadable legacy file, moving it under its original name without crashing init', async () => {
    const legacyDir = path.join(dir, 'config', 'profiles');
    await mkdir(legacyDir, { recursive: true });
    // Corrupt JSON: the slug cannot be parsed, so the target name falls back to the original filename.
    await writeFile(path.join(legacyDir, 'broken.json'), Buffer.from('{ not valid json'));
    // A directory named like a .json file — reading it throws EISDIR, which must also fall back.
    await mkdir(path.join(legacyDir, 'weird.json'), { recursive: true });

    store = new ConfigStore(dir);
    await expect(store.init()).resolves.toBeUndefined();

    // Both entries were moved to config/workspaces under their original names (neither is a valid
    // workspace, so neither loads, but init must not throw and the legacy dir must be emptied).
    expect(existsSync(path.join(dir, 'config', 'workspaces', 'broken.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'config', 'workspaces', 'weird.json'))).toBe(true);
    expect(existsSync(legacyDir)).toBe(false);
  });
});
