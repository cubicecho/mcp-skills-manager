import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../errors.ts';

/**
 * Normalize an OS-native path (which may use `\` on Windows) to POSIX separators.
 * @param p - The path to normalize.
 * @returns The same path with `/` separators.
 */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Guess whether a file is binary: it holds a NUL byte or is not decodable as UTF-8.
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
 * Resolve a caller-supplied path within a skill's directory, rejecting absolute paths and `..` traversal.
 * @param skillsDir - Absolute path of the skills dir.
 * @param name - The skill's name, which is also its directory under `skillsDir`.
 * @param relPath - The caller-supplied path, relative to the skill's directory.
 * @returns The safe POSIX-style relative path.
 * @throws HttpError 400 when the path is empty or leaves the skill's directory.
 */
export function safeSkillRelPath(skillsDir: string, name: string, relPath: string): string {
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const skillDir = path.join(skillsDir, name);
  const full = path.resolve(skillDir, cleaned);
  const rel = path.relative(skillDir, full);
  const escapesSkillDir = rel === '' || rel.startsWith('..') || path.isAbsolute(rel);
  if (escapesSkillDir) {
    throw new HttpError(400, `Unsafe file path "${relPath}"`, 'paths must stay within the skill directory');
  }
  return toPosix(rel);
}

/**
 * Remove now-empty directories, walking up from `dir`.
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
