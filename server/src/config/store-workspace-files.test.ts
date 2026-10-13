import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTempStore } from '../test/temp-store.ts';

describe('ConfigStore with two workspace files declaring one slug', () => {
  const temp = useTempStore();
  const workspacesDir = () => path.join(temp.dir, 'config', 'workspaces');
  const fileFor = (file: string) => path.join(workspacesDir(), file);
  const config = (name: string) => JSON.stringify({ name, slug: 'team', enabled: true, skills: [] });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the first file by name, says so, and saves to that file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mkdir(workspacesDir(), { recursive: true });
    await writeFile(fileFor('a.json'), config('First'));
    await writeFile(fileFor('b.json'), config('Second'));

    await temp.store.reload();

    expect(temp.store.getWorkspace('team')?.name).toBe('First');
    expect(warn).toHaveBeenCalledWith(
      `Ignoring workspace config ${fileFor('b.json')}: a.json already declares the slug "team"`,
    );

    await temp.store.saveWorkspace({ name: 'Edited', slug: 'team', enabled: true, skills: [] });

    expect(JSON.parse(await readFile(fileFor('a.json'), 'utf8')).name).toBe('Edited');
    expect(JSON.parse(await readFile(fileFor('b.json'), 'utf8')).name).toBe('Second');
  });
});
