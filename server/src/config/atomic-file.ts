import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { errorMessage } from '../errors.ts';

/** File mode for config files, which can hold the auth token: owner read/write only. */
const PRIVATE_FILE_MODE = 0o600;
/** File mode for skill content: world-readable. */
const DEFAULT_FILE_MODE = 0o644;

/**
 * Writes raw bytes atomically: a temp file in the same dir, chmod, then rename over the target.
 *
 * @param file - Absolute path of the file to write.
 * @param content - The bytes to write.
 * @param [mode] - Permission bits for the file (octal).
 *
 * @remarks
 * The temp file's name is random, so two writes of one file never share it, and it is removed when the
 * write fails.
 */
export async function writeBufferAtomic(file: string, content: Buffer, mode = DEFAULT_FILE_MODE): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, { mode });
    await chmod(tmp, mode);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Writes UTF-8 text atomically.
 *
 * @param file - Absolute path of the file to write.
 * @param content - The text to write.
 * @param [mode] - Permission bits for the file (octal).
 */
export async function writeTextAtomic(file: string, content: string, mode = DEFAULT_FILE_MODE): Promise<void> {
  await writeBufferAtomic(file, Buffer.from(content, 'utf8'), mode);
}

/**
 * Writes a value atomically as pretty-printed JSON, readable and writable by the owner only.
 *
 * @param file - Absolute path of the file to write.
 * @param value - The value to serialize.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`, PRIVATE_FILE_MODE);
}

/**
 * Reads a file as JSON.
 *
 * @param file - Absolute path of the file to read.
 * @returns The parsed value, unvalidated.
 * @throws When the file cannot be read or is not JSON.
 */
export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * Reads a JSON config file and validates it, naming the file when it is not JSON or fails validation.
 *
 * @typeParam T - The validated shape.
 * @param file - Absolute path of the file to read.
 * @param parse - Validates the parsed value, throwing when it is not the expected shape.
 * @returns The validated value.
 * @throws Error when the file is not JSON, or fails validation.
 */
export async function parseJsonFile<T>(file: string, parse: (value: unknown) => T): Promise<T> {
  const raw = await readFile(file, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${file} is not valid JSON: ${errorMessage(cause)}`, { cause });
  }
  try {
    return parse(json);
  } catch (cause) {
    throw new Error(`${file} failed validation: ${errorMessage(cause)}`, { cause });
  }
}
