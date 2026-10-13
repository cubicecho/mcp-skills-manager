import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeTextAtomic } from './atomic-file.ts';

describe('writeTextAtomic', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-atomic-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the file and leaves no temp file beside it', async () => {
    await writeTextAtomic(path.join(dir, 'a.md'), 'one');

    expect(await readFile(path.join(dir, 'a.md'), 'utf8')).toBe('one');
    expect(await readdir(dir)).toEqual(['a.md']);
  });

  it('lets two writes of one file in the same millisecond both finish', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1);
    const file = path.join(dir, 'a.md');

    await Promise.all([writeTextAtomic(file, 'one'), writeTextAtomic(file, 'two')]);

    expect(['one', 'two']).toContain(await readFile(file, 'utf8'));
    expect(await readdir(dir)).toEqual(['a.md']);
  });

  it('leaves no temp file behind when the write cannot finish', async () => {
    // A folder stands where the file should go, so the final rename fails.
    await mkdir(path.join(dir, 'taken'));

    await expect(writeTextAtomic(path.join(dir, 'taken'), 'one')).rejects.toThrow();

    expect(await readdir(dir)).toEqual(['taken']);
  });
});
