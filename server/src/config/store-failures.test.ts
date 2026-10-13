import { existsSync } from 'node:fs';
import { chmod, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTempStore } from '../test/temp-store.ts';

const READ_ONLY_DIR = 0o555;
const WRITABLE_DIR = 0o755;

/**
 * Runs `run` while a directory refuses new, renamed and removed entries, then makes it writable again.
 *
 * @param dir - Absolute path of the directory to lock.
 * @param run - What to do while it is locked.
 */
async function whileReadOnly(dir: string, run: () => Promise<void>): Promise<void> {
  await chmod(dir, READ_ONLY_DIR);
  try {
    await run();
  } finally {
    await chmod(dir, WRITABLE_DIR);
  }
}

describe('ConfigStore when the disk refuses a change', () => {
  const temp = useTempStore();
  const skillsDir = () => path.join(temp.dir, 'skills');

  it('keeps a skill it could not delete, on disk and in the catalogue', async () => {
    await temp.store.createSkill({ name: 'stuck', description: 'd', body: 'b', format: 'dir' });

    await whileReadOnly(skillsDir(), async () => {
      await expect(temp.store.deleteSkill('stuck')).rejects.toThrow();
    });

    expect(temp.store.getSkill('stuck')).toBeDefined();
    expect(existsSync(path.join(skillsDir(), 'stuck/SKILL.md'))).toBe(true);
  });

  it('keeps a file skill it could not delete', async () => {
    await temp.store.createSkill({ name: 'flat', description: 'd', body: 'b', format: 'file' });

    await whileReadOnly(skillsDir(), async () => {
      await expect(temp.store.deleteSkill('flat')).rejects.toThrow();
    });

    expect(temp.store.getSkill('flat')).toBeDefined();
    expect(existsSync(path.join(skillsDir(), 'flat.md'))).toBe(true);
  });

  it('leaves a skill under its old name when the rename cannot be finished', async () => {
    await temp.store.createSkill({ name: 'before', description: 'd', body: 'b', format: 'dir' });

    // The folder itself can still be moved; the rewritten SKILL.md cannot be written into it.
    await whileReadOnly(path.join(skillsDir(), 'before'), async () => {
      await expect(temp.store.renameSkill('before', 'after')).rejects.toThrow();
    });

    expect(existsSync(path.join(skillsDir(), 'after'))).toBe(false);
    expect(temp.store.getSkill('before')?.path).toBe('before/SKILL.md');
    await temp.store.reload();
    expect(temp.store.getSkill('before')).toBeDefined();
    expect(temp.store.getSkill('after')).toBeUndefined();
  });

  it('leaves no folder behind when an import fails part-way', async () => {
    const skill = Buffer.from('---\nname: broken\ndescription: d\n---\n\nbody\n');

    await expect(
      temp.store.importSkill({
        name: 'broken',
        format: 'dir',
        files: [
          { path: 'SKILL.md', content: skill },
          { path: 'notes', content: Buffer.from('a file') },
          // `notes` is already a file, so nothing can be written under it.
          { path: 'notes/inner.md', content: Buffer.from('x') },
        ],
      }),
    ).rejects.toThrow();

    expect(existsSync(path.join(skillsDir(), 'broken'))).toBe(false);
    await temp.store.reload();
    expect(temp.store.getSkill('broken')).toBeUndefined();
  });

  it('refuses a file import that is not Markdown', async () => {
    await expect(
      temp.store.importSkill({
        name: 'logo',
        format: 'file',
        files: [{ path: 'logo.png', content: Buffer.from('x') }],
      }),
    ).rejects.toMatchObject({ status: 400, message: 'A file-format skill must contain exactly one Markdown file' });

    expect(await readdir(skillsDir())).not.toContain('logo.md');
  });
});
