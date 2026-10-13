import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGitFolder } from './git-fetch.ts';

type ExecCallback = (err: Error | null, result?: { stdout: string }) => void;

/** What the stand-in git answers each subcommand with: an error to fail with, or nothing to succeed. */
const failures = new Map<string, Error>();

// git itself cannot be made to hang, vanish or lose a commit on demand, so the process call is stood in for.
vi.mock('node:child_process', () => ({
  execFile: (_file: string, args: string[], _options: unknown, done: ExecCallback) => {
    const failure = [...failures].find(([subcommand]) => args.includes(subcommand))?.[1];
    done(failure ?? null, { stdout: '' });
  },
}));

const SOURCE = { repo: 'https://example.com/o/r.git', path: 'skills/demo' };

describe('fetchGitFolder when git fails', () => {
  let dest: string;

  beforeEach(async () => {
    failures.clear();
    dest = await mkdtemp(path.join(tmpdir(), 'mcp-skills-git-failures-'));
  });

  afterEach(async () => {
    await rm(dest, { recursive: true, force: true });
  });

  it('answers 504 when git runs out of time, without blaming the repo', async () => {
    failures.set('clone', Object.assign(new Error('killed'), { killed: true, stderr: '' }));

    await expect(fetchGitFolder(SOURCE, dest)).rejects.toMatchObject({
      status: 504,
      message: 'Could not fetch https://example.com/o/r.git: git gave no answer within 60 seconds',
      detail: 'check that the server can reach the repo, then try again',
    });
  });

  it('answers 504 when the checkout runs out of time, not that the folder is missing', async () => {
    failures.set('checkout', Object.assign(new Error('killed'), { killed: true, stderr: '' }));

    await expect(fetchGitFolder(SOURCE, dest)).rejects.toMatchObject({ status: 504 });
  });

  it('answers 502 with the end of git’s own words when the fetched commit cannot be read', async () => {
    failures.set('rev-parse', Object.assign(new Error('exit 128'), { code: 128, stderr: 'fatal: bad revision\n' }));

    await expect(fetchGitFolder(SOURCE, dest)).rejects.toMatchObject({
      status: 502,
      message: 'Could not read the fetched commit of https://example.com/o/r.git',
      detail: 'fatal: bad revision',
    });
  });

  it('answers 500 when git is not installed', async () => {
    failures.set('clone', Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));

    await expect(fetchGitFolder(SOURCE, dest)).rejects.toMatchObject({
      status: 500,
      message: 'git is not installed on the server',
    });
  });
});
