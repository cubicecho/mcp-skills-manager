import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USAGE_FLUSH_MS } from '../core/defaults.ts';
import { UsageTracker } from './usage-tracker.ts';

describe('UsageTracker', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-usage-'));
    file = path.join(dir, 'usage.json');
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a change still waiting on its timer when closed', async () => {
    const tracker = new UsageTracker(file);
    tracker.record('demo');
    await tracker.close();
    expect(JSON.parse(await readFile(file, 'utf8')).demo.count).toBe(1);
  });

  it('waits on close for a write its timer has already started', async () => {
    const tracker = new UsageTracker(file);
    tracker.record('demo');
    // The timer fires and starts the write; nothing has awaited it yet.
    vi.advanceTimersByTime(USAGE_FLUSH_MS);
    await tracker.close();
    expect(JSON.parse(await readFile(file, 'utf8')).demo.count).toBe(1);
  });
});
