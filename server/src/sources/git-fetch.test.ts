import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchGitFolder } from './git-fetch.ts';

describe('fetchGitFolder', () => {
  let work: string;
  let repoDir: string;
  let repo: string;
  let dest: string;

  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', repoDir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      encoding: 'utf8',
    }).trim();

  const commitAll = (message: string): string => {
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  };

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'mcp-skills-git-test-'));
    repoDir = path.join(work, 'repo');
    dest = path.join(work, 'dest');
    await mkdir(path.join(repoDir, 'skills/demo/reference'), { recursive: true });
    await mkdir(dest);
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', repoDir]);
    await writeFile(path.join(repoDir, 'README.md'), '# repo\n');
    await writeFile(path.join(repoDir, 'skills/demo/SKILL.md'), '---\nname: demo\n---\nv1\n');
    await writeFile(path.join(repoDir, 'skills/demo/reference/notes.md'), 'notes\n');
    repo = pathToFileURL(repoDir).href;
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it('copies only the requested folder and reports the commit', async () => {
    const head = commitAll('first');
    const { commit } = await fetchGitFolder({ repo, path: 'skills/demo' }, dest, { allowLocal: true });
    expect(commit).toBe(head);
    expect((await readdir(dest)).sort()).toEqual(['SKILL.md', 'reference']);
    expect(await readFile(path.join(dest, 'reference/notes.md'), 'utf8')).toBe('notes\n');
  });

  it('copies the repo root without git metadata when no folder is given', async () => {
    commitAll('first');
    await fetchGitFolder({ repo }, dest, { allowLocal: true });
    expect((await readdir(dest)).sort()).toEqual(['README.md', 'skills']);
  });

  it('follows a tag rather than the default branch', async () => {
    const tagged = commitAll('first');
    git('tag', 'v1');
    await writeFile(path.join(repoDir, 'skills/demo/SKILL.md'), '---\nname: demo\n---\nv2\n');
    commitAll('second');
    const { commit } = await fetchGitFolder({ repo, ref: 'v1', path: 'skills/demo' }, dest, { allowLocal: true });
    expect(commit).toBe(tagged);
    expect(await readFile(path.join(dest, 'SKILL.md'), 'utf8')).toContain('v1');
  });

  it('leaves symlinks behind', async () => {
    await symlink('/etc/hostname', path.join(repoDir, 'skills/demo/leak'));
    commitAll('first');
    await fetchGitFolder({ repo, path: 'skills/demo' }, dest, { allowLocal: true });
    expect(existsSync(path.join(dest, 'leak'))).toBe(false);
    expect(existsSync(path.join(dest, 'SKILL.md'))).toBe(true);
  });

  it('answers 502 for an unknown ref and 400 for a missing folder', async () => {
    commitAll('first');
    await expect(fetchGitFolder({ repo, ref: 'nope' }, dest, { allowLocal: true })).rejects.toMatchObject({
      status: 502,
    });
    await expect(fetchGitFolder({ repo, path: 'missing' }, dest, { allowLocal: true })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('refuses a local repo unless local repos are allowed', async () => {
    commitAll('first');
    await expect(fetchGitFolder({ repo }, dest)).rejects.toMatchObject({ status: 502 });
  });
});
