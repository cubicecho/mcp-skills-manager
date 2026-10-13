import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitSource } from '@mcp-skills/shared';
import { HttpStatus, MAX_SKILL_FILES } from '@mcp-skills/shared';
import { EnvVar, GIT_MAX_BUFFER_BYTES, GIT_STDERR_TAIL_LENGTH, GIT_TIMEOUT_MS } from '../core/defaults.ts';
import { HttpError } from '../errors.ts';

const execFileAsync = promisify(execFile);

/** Fetches a source's folder into `destDir` and reports the commit it came from. */
export type SkillSourceFetcher = (source: GitSource, destDir: string) => Promise<{ commit: string }>;

/** Options for {@link fetchGitFolder}. */
export interface GitFetchOptions {
  /**
   * Also allows `file://` repos, which would let a request read a repo off the server's disk.
   *
   * @defaultValue `false`
   */
  allowLocal?: boolean;
}

/**
 * Runs one git command without a shell, never prompting for credentials.
 *
 * @param args - Arguments after `git`.
 * @param options - Whether local repos are allowed.
 * @returns The command's trimmed stdout.
 * @throws The raw `execFile` error when git exits non-zero, times out or is missing.
 */
async function git(args: string[], options: GitFetchOptions): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    env: {
      ...process.env,
      // Fail instead of hanging on a username/password or host-key prompt.
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: process.env[EnvVar.GitSshCommand] ?? 'ssh -oBatchMode=yes',
      GIT_ALLOW_PROTOCOL: options.allowLocal ? 'https:ssh:file' : 'https:ssh',
      // The folder is a literal path, never a pathspec pattern.
      GIT_LITERAL_PATHSPECS: '1',
    },
  });
  return stdout.trim();
}

/**
 * Turns a failed git command into the error the API answers with.
 *
 * @param err - Whatever `execFile` rejected with.
 * @param status - HTTP status to answer with when git itself ran and failed.
 * @param message - Error message for that case.
 * @returns The error to throw; a 500 saying git is not installed when the binary was not found.
 */
function gitError(err: unknown, status: number, message: string): HttpError {
  const failure = err as { code?: unknown; stderr?: unknown };
  if (failure.code === 'ENOENT') {
    return new HttpError(
      HttpStatus.InternalServerError,
      'git is not installed on the server',
      'install git to sync skills from a repo',
    );
  }
  const stderr = typeof failure.stderr === 'string' ? failure.stderr.trim() : '';
  return new HttpError(status, message, stderr.slice(-GIT_STDERR_TAIL_LENGTH) || undefined, { cause: err });
}

/**
 * Copies a checked-out folder, keeping only regular files and directories.
 *
 * @param from - Absolute path of the folder to copy.
 * @param to - Absolute path of the existing folder to copy into.
 * @param allowance - How many more files may be copied.
 * @returns The allowance left once this folder is copied.
 * @throws HttpError 400 when the folder holds more files than the allowance.
 *
 * @remarks
 * Symlinks, which could point anywhere on the server, and git's own metadata are left behind.
 */
async function copyTree(from: string, to: string, allowance: number): Promise<number> {
  let remaining = allowance;
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') {
        continue;
      }
      await mkdir(target);
      remaining = await copyTree(source, target, remaining);
    } else if (entry.isFile()) {
      remaining -= 1;
      if (remaining < 0) {
        throw new HttpError(HttpStatus.BadRequest, `The source folder holds more than ${MAX_SKILL_FILES} files`);
      }
      await copyFile(source, target);
    }
  }
  return remaining;
}

/**
 * Fetches one folder of a git repo with the git CLI.
 *
 * @param source - Repo, plus optional ref and folder; without a folder the repo's root is fetched.
 * @param destDir - Existing empty directory the folder's files are copied into.
 * @param [options] - Whether local repos are allowed.
 * @returns The commit the files came from.
 * @throws HttpError 502 when the repo or ref cannot be fetched, 400 when the folder is not in it.
 *
 * @remarks
 * The clone is shallow and blob-less, and only checks out, and so only downloads, that folder.
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
      throw gitError(err, HttpStatus.BadGateway, `Could not fetch ${source.repo}`);
    }
    const folder = source.path ?? '.';
    try {
      await git(['-C', clone, 'checkout', '--quiet', 'HEAD', '--', folder], options);
    } catch (err) {
      throw gitError(err, HttpStatus.BadRequest, `Folder "${folder}" was not found in ${source.repo}`);
    }
    let commit: string;
    try {
      commit = await git(['-C', clone, 'rev-parse', 'HEAD'], options);
    } catch (err) {
      throw gitError(err, HttpStatus.BadGateway, `Could not read the fetched commit of ${source.repo}`);
    }
    const root = path.join(clone, folder);
    // lstat, not stat: a symlink standing in for the folder must not be followed out of the clone.
    const isFolder = (await lstat(root)).isDirectory();
    if (isFolder === false) {
      throw new HttpError(HttpStatus.BadRequest, `"${folder}" in ${source.repo} is not a folder`);
    }
    await copyTree(root, destDir, MAX_SKILL_FILES);
    return { commit };
  } finally {
    await rm(clone, { recursive: true, force: true });
  }
}
