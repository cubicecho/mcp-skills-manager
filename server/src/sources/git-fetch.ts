import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitSource } from '@mcp-skills/shared';
import { HttpError } from '../errors.ts';

const execFileAsync = promisify(execFile);

/** Longest a single git command may run, in milliseconds. */
const GIT_TIMEOUT_MS = 60_000;
/** Most files a fetched skill folder may hold (matches the upload limit). */
const MAX_SOURCE_FILES = 500;
/** How much of git's stderr is passed back as the error detail, in characters. */
const STDERR_TAIL_LENGTH = 600;

/** Fetches a source's folder into `destDir` and reports the commit it came from. */
export type SkillSourceFetcher = (source: GitSource, destDir: string) => Promise<{ commit: string }>;

/** Options for {@link fetchGitFolder}. */
export interface GitFetchOptions {
  /** Also allow `file://` repos. Off by default so a request can never read a repo off the server's disk. */
  allowLocal?: boolean;
}

/**
 * Runs one git command without a shell, never prompting for credentials.
 * @param args Arguments after `git`.
 * @param options Whether local repos are allowed.
 * @returns The command's trimmed stdout.
 * @throws The raw `execFile` error when git exits non-zero, times out or is missing.
 */
async function git(args: string[], options: GitFetchOptions): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      // Fail instead of hanging on a username/password or host-key prompt.
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -oBatchMode=yes',
      GIT_ALLOW_PROTOCOL: options.allowLocal ? 'https:ssh:file' : 'https:ssh',
      // The folder is a literal path, never a pathspec pattern.
      GIT_LITERAL_PATHSPECS: '1',
    },
  });
  return stdout.trim();
}

/**
 * Turns a failed git command into the error the API answers with.
 * @param err Whatever `execFile` rejected with.
 * @param status HTTP status to answer with when git itself ran and failed.
 * @param message Error message for that case.
 * @returns The error to throw.
 */
function gitError(err: unknown, status: number, message: string): HttpError {
  const failure = err as { code?: unknown; stderr?: unknown };
  if (failure.code === 'ENOENT') {
    return new HttpError(500, 'git is not installed on the server', 'install git to sync skills from a repo');
  }
  const stderr = typeof failure.stderr === 'string' ? failure.stderr.trim() : '';
  return new HttpError(status, message, stderr.slice(-STDERR_TAIL_LENGTH) || undefined, { cause: err });
}

/**
 * Copies a checked-out folder, keeping only regular files and directories: symlinks
 * (which could point anywhere on the server) and git's own metadata are left behind.
 * @param from Absolute path of the folder to copy.
 * @param to Absolute path of the existing folder to copy into.
 * @param budget Remaining file allowance, shared across the whole tree.
 */
async function copyTree(from: string, to: string, budget: { remaining: number }): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') {
        continue;
      }
      await mkdir(target);
      await copyTree(source, target, budget);
    } else if (entry.isFile()) {
      budget.remaining -= 1;
      if (budget.remaining < 0) {
        throw new HttpError(400, `The source folder holds more than ${MAX_SOURCE_FILES} files`);
      }
      await copyFile(source, target);
    }
  }
}

/**
 * Fetches one folder of a git repo with the git CLI: a shallow, blob-less clone
 * that only checks out (and so only downloads) that folder.
 * @param source Repo, plus optional ref and folder.
 * @param destDir Existing empty directory the folder's files are copied into.
 * @param options Whether local repos are allowed.
 * @returns The commit the files came from.
 * @throws HttpError 502 when the repo or ref cannot be fetched, 400 when the folder is not in it.
 */
export async function fetchGitFolder(
  source: GitSource,
  destDir: string,
  options: GitFetchOptions = {},
): Promise<{ commit: string }> {
  const clone = await mkdtemp(path.join(tmpdir(), 'mcp-skills-git-'));
  try {
    const branch = source.ref ? ['--branch', source.ref] : [];
    try {
      await git(
        [
          'clone',
          '--quiet',
          '--depth',
          '1',
          '--filter=blob:none',
          '--no-checkout',
          ...branch,
          '--',
          source.repo,
          clone,
        ],
        options,
      );
    } catch (err) {
      throw gitError(err, 502, `Could not fetch ${source.repo}`);
    }
    const folder = source.path ?? '.';
    try {
      await git(['-C', clone, 'checkout', '--quiet', 'HEAD', '--', folder], options);
    } catch (err) {
      throw gitError(err, 400, `Folder "${folder}" was not found in ${source.repo}`);
    }
    const commit = await git(['-C', clone, 'rev-parse', 'HEAD'], options);
    const root = path.join(clone, folder);
    // lstat, not stat: a symlink standing in for the folder must not be followed out of the clone.
    const isFolder = (await lstat(root)).isDirectory();
    if (!isFolder) {
      throw new HttpError(400, `"${folder}" in ${source.repo} is not a folder`);
    }
    await copyTree(root, destDir, { remaining: MAX_SOURCE_FILES });
    return { commit };
  } finally {
    await rm(clone, { recursive: true, force: true });
  }
}
