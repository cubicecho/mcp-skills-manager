import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { errorMessage } from '../errors.ts';

/** File mode for config files, which can hold the auth token: owner read/write only. */
const PRIVATE_FILE_MODE = 0o600;
/** File mode for skill content: world-readable. */
const DEFAULT_FILE_MODE = 0o644;

/**
 * Atomically write raw bytes: a temp file in the same dir, chmod, then rename over the target.
 * @param file - Absolute path of the file to write.
 * @param content - The bytes to write.
 * @param mode - Permission bits for the file (octal).
 */
export async function writeBufferAtomic(file: string, content: Buffer, mode = DEFAULT_FILE_MODE): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, { mode });
  await chmod(tmp, mode);
  await rename(tmp, file);
}

/**
 * Atomically write UTF-8 text.
 * @param file - Absolute path of the file to write.
 * @param content - The text to write.
 * @param mode - Permission bits for the file (octal).
 */
export async function writeTextAtomic(file: string, content: string, mode = DEFAULT_FILE_MODE): Promise<void> {
  await writeBufferAtomic(file, Buffer.from(content, 'utf8'), mode);
}

/**
 * Atomically write a value as pretty-printed JSON, readable by the owner only.
 * @param file - Absolute path of the file to write.
 * @param value - The value to serialize.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`, PRIVATE_FILE_MODE);
}

/**
 * Read a file as JSON.
 * @param file - Absolute path of the file to read.
 * @returns The parsed value, unvalidated.
 * @throws When the file cannot be read or is not JSON.
 */
export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * Read a JSON config file and validate it, naming the file in whatever goes wrong.
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
