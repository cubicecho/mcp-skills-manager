import type { Dirent } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { HttpStatus } from '@mcp-skills/shared';
import { HttpError } from '../errors.ts';

/**
 * Normalizes an OS-native path (which may use `\` on Windows) to POSIX separators.
 *
 * @param p - The path to normalize.
 * @returns The same path with `/` separators.
 */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Guesses whether a file is binary: it holds a NUL byte or is not decodable as UTF-8.
 *
 * @param buffer - The file's contents.
 * @returns True when the contents should be treated as binary.
 */
export function isBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return true;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return false;
  } catch {
    return true;
  }
}

/**
 * Resolves a caller-supplied path within a skill's directory, reading a leading slash as the skill root
 * and rejecting `..` traversal.
 *
 * @param relPath - The caller-supplied path, relative to the skill's directory.
 * @returns The safe POSIX-style relative path.
 * @throws HttpError 400 when the path is empty or leaves the skill's directory.
 */
export function safeRelPath(relPath: string): string {
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  // Any absolute directory answers the same; the path is only measured against it.
  const skillDir = path.resolve('skill');
  const full = path.resolve(skillDir, cleaned);
  const rel = path.relative(skillDir, full);
  const escapesSkillDir = rel === '' || rel.startsWith('..') || path.isAbsolute(rel);
  if (escapesSkillDir) {
    throw new HttpError(
      HttpStatus.BadRequest,
      `Unsafe file path "${relPath}"`,
      'paths must stay within the skill directory',
    );
  }
  return toPosix(rel);
}

/**
 * Removes now-empty directories, walking up from `dir` until one still holds something.
 *
 * @param dir - Absolute path of the first directory to check.
 * @param stopAt - Absolute path of the ancestor to stop below; it is never removed.
 */
export async function pruneEmptyDirs(dir: string, stopAt: string): Promise<void> {
  const isBelowStop = (candidate: string): boolean => candidate !== stopAt && candidate.startsWith(stopAt + path.sep);
  let current = dir;
  while (isBelowStop(current)) {
    const remaining = await readdir(current);
    if (remaining.length > 0) {
      break;
    }
    await rm(current, { recursive: true, force: true });
    current = path.dirname(current);
  }
}

/** One entry found while walking a directory tree. */
export interface WalkedEntry {
  /** The directory entry itself. */
  entry: Dirent;
  /** Absolute path of the entry. */
  full: string;
}

/**
 * Walks a directory tree depth-first, yielding each directory before its contents.
 *
 * @param dir - Absolute path of the directory to walk.
 * @returns Every entry under `dir`, in `readdir` order.
 */
export async function* walkEntries(dir: string): AsyncGenerator<WalkedEntry> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    yield { entry, full };
    if (entry.isDirectory()) {
      yield* walkEntries(full);
    }
  }
}
