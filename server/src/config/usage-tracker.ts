import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { SkillUsage } from '@mcp-skills/shared';
import { skillUsageSchema } from '@mcp-skills/shared';
import { errorMessage } from '../errors.ts';
import { writeJsonAtomic } from './atomic-file.ts';

/** Coalesce bursts of skill loads into one usage.json write (milliseconds). */
const USAGE_FLUSH_MS = 500;

/**
 * Per-skill load statistics. They are authoritative in memory once loaded and are
 * flushed to usage.json after each change; the write is debounced and best-effort.
 */
export class UsageTracker {
  private usage = new Map<string, SkillUsage>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly file: string;

  /**
   * @param file - Absolute path of usage.json.
   */
  constructor(file: string) {
    this.file = file;
  }

  /** Replace the in-memory stats with what usage.json holds; a missing or unreadable file counts as empty. */
  async load(): Promise<void> {
    this.usage = await this.read();
  }

  /**
   * Read a skill's usage stats.
   * @param name - Skill slug.
   * @returns The stats, or zeros when the skill has never been loaded.
   */
  get(name: string): SkillUsage {
    return this.usage.get(name) ?? { count: 0, lastUsedAt: null };
  }

  /**
   * Record one load of a skill: bump its count and stamp `lastUsedAt` with the current time.
   * @param name - Skill slug.
   */
  record(name: string): void {
    const prev = this.usage.get(name);
    this.usage.set(name, { count: (prev?.count ?? 0) + 1, lastUsedAt: new Date().toISOString() });
    this.scheduleFlush();
  }

  /**
   * Carry a skill's stats over to its new name on rename, so history is not lost.
   * @param from - The skill's old name.
   * @param to - The skill's new name.
   */
  retarget(from: string, to: string): void {
    const stats = this.usage.get(from);
    if (stats) {
      this.usage.delete(from);
      this.usage.set(to, stats);
      this.scheduleFlush();
    }
  }

  /**
   * Drop a deleted skill's stats.
   * @param name - Skill slug.
   */
  forget(name: string): void {
    if (this.usage.delete(name)) {
      this.scheduleFlush();
    }
  }

  /** Write any pending change now, so counts survive a graceful shutdown. */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      await this.flush().catch(() => {});
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((err: unknown) => {
        console.error(`Persisting skill usage failed: ${errorMessage(err)}`);
      });
    }, USAGE_FLUSH_MS);
  }

  private async flush(): Promise<void> {
    await writeJsonAtomic(this.file, Object.fromEntries(this.usage));
  }

  private async read(): Promise<Map<string, SkillUsage>> {
    if (!existsSync(this.file)) {
      return new Map();
    }
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, unknown>;
      const usage = new Map<string, SkillUsage>();
      for (const [name, value] of Object.entries(parsed)) {
        const result = skillUsageSchema.safeParse(value);
        if (result.success) {
          usage.set(name, result.data);
        }
      }
      return usage;
    } catch (err) {
      console.error(`Ignoring unreadable usage.json: ${errorMessage(err)}`);
      return new Map();
    }
  }
}
