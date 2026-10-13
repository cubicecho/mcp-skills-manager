import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { ConfigStore } from '../config/store.ts';

/** The store a test is running against, and the data directory it reads and writes. */
export interface TempStore {
  /** Absolute path of the test's own temp data directory. */
  dir: string;
  /** A store over `dir`, already initialised. */
  store: ConfigStore;
}

/**
 * Gives each test in the enclosing `describe` a fresh store over its own temp data directory, and
 * closes the store and removes the directory afterwards.
 *
 * @param [options] - Passed to the store, e.g. a fake `fetchSource`.
 * @returns The current test's store and directory, replaced before each test.
 *
 * @remarks
 * Call it in the `describe` body; read `dir` and `store` inside the tests.
 */
export function useTempStore(options?: ConstructorParameters<typeof ConfigStore>[1]): TempStore {
  // Filled in before each test; nothing reads it earlier.
  const temp = {} as TempStore;

  beforeEach(async () => {
    temp.dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-test-'));
    temp.store = new ConfigStore(temp.dir, options);
    await temp.store.init();
  });

  afterEach(async () => {
    await temp.store.close();
    await rm(temp.dir, { recursive: true, force: true });
  });

  return temp;
}
