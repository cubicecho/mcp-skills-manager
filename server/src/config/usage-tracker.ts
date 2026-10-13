import { existsSync } from 'node:fs';
import type { SkillUsage } from '@mcp-skills/shared';
import { skillUsageSchema } from '@mcp-skills/shared';
import { z } from 'zod';
import { USAGE_FLUSH_MS } from '../core/defaults.ts';
import { errorMessage } from '../errors.ts';
import { readJsonFile, writeJsonAtomic } from './atomic-file.ts';

/**
 * Holds per-skill load statistics.
 *
 * @remarks
 * They are authoritative in memory once loaded. Each change schedules a write to usage.json, which is
 * delayed so that changes close together share one write, and is best-effort.
 */
export class UsageTracker {
  /** Stats keyed by skill name; a skill never loaded has no entry. */
  private usage = new Map<string, SkillUsage>();
  /** The scheduled write; null when nothing is waiting to be written. */
  private flushTimer: NodeJS.Timeout | null = null;
  /** Absolute path of usage.json. */
  private readonly file: string;

  /**
   * Sets where the stats are kept; nothing is read until `load`.
   *
   * @param file - Absolute path of usage.json.
   */
  constructor(file: string) {
    this.file = file;
  }

  /** Replaces the in-memory stats with what usage.json holds; a missing or unreadable file counts as empty. */
  async load(): Promise<void> {
    this.usage = await this.read();
  }

  /**
   * Reads a skill's usage stats.
   *
   * @param name - Skill slug.
   * @returns The stats, or zeros when the skill has never been loaded.
   */
  get(name: string): SkillUsage {
    return this.usage.get(name) ?? { count: 0, lastUsedAt: null };
  }

  /**
   * Records one load of a skill: bumps its count and stamps `lastUsedAt` with the current time.
   *
   * @param name - Skill slug.
   */
  record(name: string): void {
    const prev = this.usage.get(name);
    this.usage.set(name, { count: (prev?.count ?? 0) + 1, lastUsedAt: new Date().toISOString() });
    this.scheduleFlush();
  }

  /**
   * Carries a skill's stats over to its new name on rename, so history is not lost.
   *
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
   * Drops a deleted skill's stats.
   *
   * @param name - Skill slug.
   */
  forget(name: string): void {
    if (this.usage.delete(name)) {
      this.scheduleFlush();
    }
  }

  /** Writes a change still waiting on its timer now, so counts survive a graceful shutdown; a failure is ignored. */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      await this.flush().catch(() => {});
    }
  }

  /** Schedules a write `USAGE_FLUSH_MS` from now, unless one is already waiting; a failed write is logged. */
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

  /** Writes every skill's stats to usage.json. */
  private async flush(): Promise<void> {
    await writeJsonAtomic(this.file, Object.fromEntries(this.usage));
  }

  /**
   * Reads usage.json.
   *
   * @returns The stats keyed by skill name, less any malformed entry; empty when the file is missing or unreadable.
   */
  private async read(): Promise<Map<string, SkillUsage>> {
    if (!existsSync(this.file)) {
      return new Map();
    }
    try {
      const parsed = z.record(z.string(), z.unknown()).parse(await readJsonFile(this.file));
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
