import { chmod, rename, writeFile } from 'node:fs/promises';

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
