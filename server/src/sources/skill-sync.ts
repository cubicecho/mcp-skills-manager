import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { GitSource, Skill, SkillFrontmatter } from '@mcp-skills/shared';
import { HttpStatus, slugify, slugSchema } from '@mcp-skills/shared';
import { writeTextAtomic } from '../config/atomic-file.ts';
import { SKILL_FILE, skillFolder } from '../config/skill-layout.ts';
import { HttpError } from '../errors.ts';
import { localFlags, parseMarkdown, serializeMarkdown } from '../skills/markdown.ts';
import type { SkillSourceFetcher } from './git-fetch.ts';

/** A source folder fetched into the staging area, ready to be moved into place. */
export interface StagedSource {
  /** Scratch directory holding the staged folder; removed once the sync finishes. */
  work: string;
  /** The fetched skill folder, with a SKILL.md at its root. */
  dir: string;
  /** Commit the folder was fetched from. */
  commit: string;
}

/** The skill a staged source folder is installed as. */
export interface SyncTarget {
  /** The skill's local name, which stays its identity whatever upstream declares. */
  name: string;
  /** Where the folder was fetched from. */
  source: GitSource;
  /** Whether the skill is served on the root endpoint. */
  global: boolean;
  /** Whether agents may edit the skill. */
  readOnly: boolean;
  /** The skill being replaced, when there is one. */
  replaces?: Skill;
}

/**
 * Fetches skills from git and swaps them into the skills dir. It moves folders only: loading the
 * result into the catalogue is the store's.
 */
export class SkillSync {
  private readonly skillsDir: string;
  /**
   * Staging area for skills fetched from git. Kept OUTSIDE the watched dirs (a staged SKILL.md
   * under skills/ would load as a skill) but on the same filesystem, so moving a fetched
   * folder into place is a single rename.
   */
  private readonly syncDir: string;
  private readonly fetchSource: SkillSourceFetcher;
  /** Names of skills with a sync or link in flight; a second one is refused rather than interleaved. */
  private readonly syncing = new Set<string>();

  /**
   * @param dirs - The skills dir, and the staging dir beside it.
   * @param fetchSource - Fetches a linked skill's folder from its git source.
   */
  constructor(dirs: { skillsDir: string; syncDir: string }, fetchSource: SkillSourceFetcher) {
    this.skillsDir = dirs.skillsDir;
    this.syncDir = dirs.syncDir;
    this.fetchSource = fetchSource;
  }

  /** Run a sync for `name`, refusing a second one while the first is still in flight. */
  async exclusiveSync<T>(name: string, run: () => Promise<T>): Promise<T> {
    if (this.syncing.has(name)) {
      throw new HttpError(HttpStatus.Conflict, `Skill "${name}" is already syncing`);
    }
    this.syncing.add(name);
    try {
      return await run();
    } finally {
      this.syncing.delete(name);
    }
  }

  /** Fetch a source into the staging area, hand it to `use`, and clean the staging area up afterwards. */
  async withStagedSource<T>(source: GitSource, use: (staged: StagedSource) => Promise<T>): Promise<T> {
    await mkdir(this.syncDir, { recursive: true });
    const work = await mkdtemp(path.join(this.syncDir, 'sync-'));
    try {
      const dir = path.join(work, 'skill');
      await mkdir(dir);
      const { commit } = await this.fetchSource(source, dir);
      if (!existsSync(path.join(dir, SKILL_FILE))) {
        throw new HttpError(HttpStatus.BadRequest, 'The source folder has no SKILL.md at its root');
      }
      return await use({ work, dir, commit });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /** The name a freshly imported source gets: its declared `name`, else its folder's (or repo's) name. */
  async sourceSkillName(source: GitSource, staged: StagedSource): Promise<string> {
    const { frontmatter } = parseMarkdown(await readFile(path.join(staged.dir, SKILL_FILE), 'utf8'));
    const declared = slugSchema.safeParse(frontmatter.name);
    if (declared.success) {
      return declared.data;
    }
    const basename = (source.path ?? source.repo.replace(/\.git$/, '')).split(/[/:]/).pop() ?? '';
    const derived = slugSchema.safeParse(slugify(basename));
    if (!derived.success) {
      throw new HttpError(
        HttpStatus.BadRequest,
        'Could not derive a skill name from the source; give the skill a name',
      );
    }
    return derived.data;
  }

  /**
   * Move a staged source folder into place as the skill `name`. Upstream's SKILL.md is rewritten so
   * the local identity and local-only settings win and the link (with the fetched commit) is recorded.
   * @param staged - The fetched folder.
   * @param target - The skill it becomes.
   * @returns The folder the skill now occupies, relative to the skills dir.
   */
  async installStaged(staged: StagedSource, target: SyncTarget): Promise<string> {
    const { name, source, replaces } = target;
    const skillFile = path.join(staged.dir, SKILL_FILE);
    const upstream = parseMarkdown(await readFile(skillFile, 'utf8'));
    const frontmatter: SkillFrontmatter = {
      ...upstream.frontmatter,
      // The local name stays the identity even when upstream declares another, so workspace
      // membership and usage stats never orphan.
      name,
      ...localFlags(target),
      source: {
        repo: source.repo,
        ...(source.ref ? { ref: source.ref } : {}),
        ...(source.path ? { path: source.path } : {}),
        commit: staged.commit,
        syncedAt: new Date().toISOString(),
      },
    };
    await writeTextAtomic(skillFile, serializeMarkdown(frontmatter, upstream.body));

    const folder = replaces ? skillFolder(replaces) : name;
    const live = path.join(this.skillsDir, folder);
    const retired = path.join(staged.work, 'old');
    const hadFolder = existsSync(live);
    if (hadFolder) {
      await rename(live, retired);
    }
    try {
      await rename(staged.dir, live);
    } catch (err) {
      if (hadFolder) {
        await rename(retired, live);
      }
      throw err;
    }
    if (replaces?.format === 'file') {
      await rm(path.join(this.skillsDir, replaces.path), { force: true });
    }
    return folder;
  }
}
