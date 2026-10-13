import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { type Dirent, existsSync, type Stats } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  GitSource,
  SettingsFile,
  SettingsView,
  Skill,
  SkillFile,
  SkillFileRead,
  SkillFrontmatter,
  SkillUsage,
  UpdateSkillRequest,
  WorkspaceConfig,
} from '@mcp-skills/shared';
import {
  HttpStatus,
  isReadOnlyFlag,
  normalizeTags,
  settingsFileSchema,
  settingsViewSchema,
  skillSchema,
  skillSourceSchema,
  slugSchema,
  workspaceConfigSchema,
} from '@mcp-skills/shared';
import { type FSWatcher, watch } from 'chokidar';
import { zipSync } from 'fflate';
import { resolveAuth } from '../auth.ts';
import { AUTH_TOKEN_BYTES, WATCH_DEBOUNCE_MS } from '../core/defaults.ts';
import { errorMessage, HttpError } from '../errors.ts';
import { localFlags, parseMarkdown, serializeMarkdown } from '../skills/markdown.ts';
import { byName, ORDER_LOCALE } from '../skills/skill-name.ts';
import { fetchGitFolder, type SkillSourceFetcher } from '../sources/git-fetch.ts';
import { SkillSync, type StagedSource, type SyncTarget } from '../sources/skill-sync.ts';
import { parseJsonFile, writeBufferAtomic, writeJsonAtomic, writeTextAtomic } from './atomic-file.ts';
import { isBinary, pruneEmptyDirs, safeRelPath, toPosix, walkEntries } from './skill-files.ts';
import { dirSkillPath, fileSkillPath, isMarkdownFile, SKILL_FILE, skillFolder, skillPath } from './skill-layout.ts';
import { STARTER_SKILL, STARTER_WORKSPACE } from './starter-skill.ts';
import { UsageTracker } from './usage-tracker.ts';

/** A point-in-time copy of everything the store holds; the payload of its `change` event. */
export interface ConfigState {
  /** Settings as stored, auth token included. */
  settings: SettingsFile;
  /** Every skill, sorted by name. */
  skills: Skill[];
  /** Every workspace, sorted by display name. */
  workspaces: WorkspaceConfig[];
}

/** Collaborators a store can be built with; the defaults are what production uses. */
export interface ConfigStoreOptions {
  /**
   * Fetches a linked skill's folder from its git source.
   *
   * @defaultValue `fetchGitFolder`
   */
  fetchSource?: SkillSourceFetcher;
}

/**
 * Refuses a path that names the skill's own document, which is not a supporting file.
 *
 * @param rel - Safe path relative to the skill's folder.
 * @throws HttpError 400 when the path is SKILL.md.
 */
function requireNotSkillFile(rel: string): void {
  if (rel === SKILL_FILE) {
    throw new HttpError(
      HttpStatus.BadRequest,
      `${SKILL_FILE} is the skill's own document, not a supporting file`,
      'change it by editing the skill body (update_skill or edit_skill over MCP)',
    );
  }
}

/**
 * Stats a path that may not be there.
 *
 * @param full - Absolute path.
 * @returns Its stats, or undefined when it cannot be read (missing, or not permitted).
 */
async function statOrUndefined(full: string): Promise<Stats | undefined> {
  try {
    return await stat(full);
  } catch {
    return undefined;
  }
}

/**
 * Makes an uploaded skill document declare the name it is being saved under.
 *
 * @param content - The uploaded SKILL.md or flat `.md`.
 * @param name - The name the upload was given.
 * @returns The content untouched when it declares no name or this one; else a copy declaring `name`.
 *
 * @remarks
 * A document that declares another name would load as that skill, shadowing it or hiding the upload.
 */
function declaringName(content: Buffer, name: string): Buffer {
  const { frontmatter, body } = parseMarkdown(content.toString('utf8'));
  if (frontmatter.name === undefined || frontmatter.name === name) {
    return content;
  }
  return Buffer.from(serializeMarkdown({ ...frontmatter, name }, body));
}

/**
 * Owns the flat, hand-editable state under DATA_DIR and keeps a copy of it in memory.
 *
 * @remarks
 * The state is config/settings.json, config/workspaces/<slug>.json, and skills/<name>.md or
 * skills/<name>/SKILL.md (Markdown with YAML frontmatter). File writes are atomic: a temp file, then a rename.
 * Once watching, it emits `change` with the new state after a debounced reload of either tree.
 */
export class ConfigStore extends EventEmitter<{ change: [ConfigState] }> {
  /** `<dataDir>/config`, holding settings.json and the workspaces dir. */
  private readonly configDir: string;
  /** `<configDir>/workspaces`, one `<slug>.json` per workspace. */
  private readonly workspacesDir: string;
  /** `<dataDir>/skills`, holding every skill's file or folder. */
  private readonly skillsDir: string;
  /** Absolute path to settings.json. */
  private readonly settingsFile: string;
  /**
   * `<dataDir>/.sync`, where a folder is built before it goes live and parked on its way out.
   *
   * @remarks
   * It is outside the watched dirs and on the skills dir's filesystem, so a move either way is one rename.
   */
  private readonly stagingDir: string;

  /** Settings in force; the schema defaults until the first load. */
  private settings: SettingsFile = settingsFileSchema.parse({});
  /** The catalogue, keyed by canonical skill name. */
  private skills = new Map<string, Skill>();
  /** Workspaces keyed by slug. */
  private workspaces = new Map<string, WorkspaceConfig>();
  /** The file name each loaded workspace was read from, keyed by slug; it need not be `<slug>.json`. */
  private workspaceFileNames = new Map<string, string>();
  /** The file watcher; null until `startWatching` and again after `close`. */
  private watcher: FSWatcher | null = null;
  /** The reload waiting on a burst of watch events to end; null when none is waiting. */
  private watchDebounce: NodeJS.Timeout | null = null;
  /** Usage stats, authoritative in memory once loaded; flushed to usage.json (unwatched) after each record. */
  private readonly usage: UsageTracker;
  /** Absolute path to usage.json, at the dataDir root and outside the watched dirs so a write triggers no reload. */
  private readonly usageFile: string;
  /** Fetches linked skills from git and swaps them in; it stages under `.sync`, outside the watched dirs. */
  private readonly sync: SkillSync;

  /**
   * Sets up the paths and collaborators; nothing is read from disk until `init`.
   *
   * @param dataDir - Root directory holding `config/`, `skills/`, usage.json and the `.sync` staging area.
   * @param [options] - Collaborators to swap in, such as a fake `fetchSource` in tests.
   */
  constructor(dataDir: string, options: ConfigStoreOptions = {}) {
    super();
    // Each live stateful-HTTP MCP session holds a `change` listener until it disconnects, so the count
    // tracks concurrent clients and is no leak signal: turn the 10-listener warning off.
    this.setMaxListeners(0);
    this.configDir = path.join(dataDir, 'config');
    this.workspacesDir = path.join(this.configDir, 'workspaces');
    this.skillsDir = path.join(dataDir, 'skills');
    this.settingsFile = path.join(this.configDir, 'settings.json');
    this.usageFile = path.join(dataDir, 'usage.json');
    this.usage = new UsageTracker(this.usageFile);
    this.stagingDir = path.join(dataDir, '.sync');
    this.sync = new SkillSync(
      { skillsDir: this.skillsDir, syncDir: this.stagingDir },
      options.fetchSource ?? fetchGitFolder,
    );
  }

  /** Creates the directories, loads everything, then seeds the defaults when the store is empty. */
  async init(): Promise<void> {
    await mkdir(this.workspacesDir, { recursive: true });
    await mkdir(this.skillsDir, { recursive: true });
    await this.loadAll();
    // Usage lives outside the watched dirs and stays authoritative in memory, so it is loaded
    // once here rather than in loadAll() (which reruns on every disk-change reload).
    await this.usage.load();
    await this.seedDefaults();
  }

  /**
   * Writes a starter skill and a workspace listing it when no skill and no workspace is loaded.
   *
   * @remarks
   * A fresh install then has working content on the web UI and the MCP endpoints. It runs only from
   * `init`, so a setup emptied mid-session stays empty until the server next starts.
   */
  private async seedDefaults(): Promise<void> {
    if (this.skills.size > 0 || this.workspaces.size > 0) {
      return;
    }
    console.log('No skills or workspaces found; seeding a starter skill and workspace.');
    await this.createSkill(STARTER_SKILL);
    await this.saveWorkspace(workspaceConfigSchema.parse(STARTER_WORKSPACE));
  }

  /**
   * Re-reads settings, skills and workspaces from disk.
   *
   * @returns The new snapshot.
   */
  async reload(): Promise<ConfigState> {
    await this.loadAll();
    return this.snapshot();
  }

  /**
   * Watches the config and skills dirs: a burst of changes reloads the store, then emits `change`.
   *
   * @remarks
   * The watch has no depth limit, since a skill lists its files however deep they are.
   */
  startWatching(): void {
    if (this.watcher) {
      return;
    }
    this.watcher = watch([this.configDir, this.skillsDir], { ignoreInitial: true });
    this.watcher.on('all', () => {
      if (this.watchDebounce) {
        clearTimeout(this.watchDebounce);
      }
      this.watchDebounce = setTimeout(() => {
        this.watchDebounce = null;
        this.reload()
          .then((state) => this.emit('change', state))
          .catch((err: unknown) => {
            console.error(`Reload after file change failed: ${errorMessage(err)}`);
          });
      }, WATCH_DEBOUNCE_MS);
    });
  }

  /** Drops a pending reload, flushes pending usage counts and stops the watcher; call on shutdown. */
  async close(): Promise<void> {
    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
    // Flush any pending usage write so counts survive a graceful shutdown.
    await this.usage.close();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Captures the current settings, skills and workspaces.
   *
   * @returns The state, with skills and workspaces sorted by name.
   */
  snapshot(): ConfigState {
    return {
      settings: this.settings,
      skills: this.getSkills(),
      workspaces: this.getWorkspaces(),
    };
  }

  /**
   * Reads the settings as stored, auth token included.
   *
   * @returns The in-memory settings.json contents.
   */
  getSettings(): SettingsFile {
    return this.settings;
  }

  /**
   * Merges a partial update into the settings, writes settings.json and applies it in memory.
   *
   * @param patch - The keys to change; the merged result is validated before anything is written.
   * @returns The settings now in force.
   */
  async updateSettings(patch: Partial<SettingsFile>): Promise<SettingsFile> {
    const next = settingsFileSchema.parse({ ...this.settings, ...patch });
    await writeJsonAtomic(this.settingsFile, next);
    this.settings = next;
    return next;
  }

  /**
   * Lists every skill, global or not.
   *
   * @returns The skills sorted by name.
   */
  getSkills(): Skill[] {
    return [...this.skills.values()].sort(byName);
  }

  /**
   * Lists the skills served on the root `/mcp` aggregate.
   *
   * @returns Every skill except those flagged `global: false`, sorted by name.
   */
  getGlobalSkills(): Skill[] {
    return this.getSkills().filter((skill) => skill.global);
  }

  /**
   * Reads `settings.authoringEnabled`.
   *
   * @returns True when agents may author skills over MCP.
   */
  isAuthoringEnabled(): boolean {
    return this.settings.authoringEnabled;
  }

  /**
   * Reads `settings.disabledAuthoringTools`.
   *
   * @returns Names of the authoring tools left out of every MCP endpoint.
   */
  getDisabledAuthoringTools(): string[] {
    return this.settings.disabledAuthoringTools;
  }

  /**
   * Reads `settings.skillToolMode`.
   *
   * @returns How skills are exposed as MCP tools: one tool per skill, or a single loader tool.
   */
  getSkillToolMode(): SettingsFile['skillToolMode'] {
    return this.settings.skillToolMode;
  }

  /**
   * Reads `settings.httpLiveUpdates`.
   *
   * @returns True when the HTTP `/mcp` endpoints run stateful so they can push live updates.
   */
  isHttpLiveUpdates(): boolean {
    return this.settings.httpLiveUpdates;
  }

  /**
   * Resolves the skill-tool mode a workspace endpoint uses.
   *
   * @param workspace - The workspace being served.
   * @returns Its own override when it has one, else `settings.skillToolMode`.
   */
  getSkillToolModeForWorkspace(workspace: WorkspaceConfig): SettingsFile['skillToolMode'] {
    return workspace.skillToolMode ?? this.settings.skillToolMode;
  }

  /**
   * Builds the settings as the management API exposes them.
   *
   * @returns The subset `settingsViewSchema` picks, which leaves the auth token out.
   */
  getSettingsView(): SettingsView {
    return settingsViewSchema.parse(this.settings);
  }

  /**
   * Looks a skill up by its canonical name.
   *
   * @param name - Skill slug.
   * @returns The skill, or undefined when there is none.
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Lists the skills a workspace serves.
   *
   * @param workspace - The workspace whose member list is resolved.
   * @returns Its skills in the declared order, without repeats or members that no longer exist.
   */
  getSkillsForWorkspace(workspace: WorkspaceConfig): Skill[] {
    const seen = new Set<string>();
    const result: Skill[] = [];
    for (const name of workspace.skills) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      const skill = this.skills.get(name);
      if (skill) {
        result.push(skill);
      }
    }
    return result;
  }

  /**
   * Reads a skill's usage stats.
   *
   * @param name - Skill slug.
   * @returns The stats; zeros when the skill has never been loaded.
   */
  getUsage(name: string): SkillUsage {
    return this.usage.get(name);
  }

  /**
   * Records one load of a skill's body over MCP: bumps its count and stamps `lastUsedAt`.
   *
   * @param name - Skill slug.
   *
   * @remarks
   * The write to usage.json is delayed and best-effort, so it never blocks or fails a load.
   */
  recordSkillUse(name: string): void {
    this.usage.record(name);
  }

  /**
   * Creates a skill and writes its document.
   *
   * @param input - The skill to write.
   * @returns The new skill, as loaded back from disk. Throws 409 when the name is taken.
   */
  async createSkill(input: {
    /** Skill slug; it must be free. */
    name: string;
    /** One-line summary, written to frontmatter. */
    description: string;
    /** Markdown under the frontmatter. */
    body: string;
    /**
     * Layout on disk: `file` writes skills/<name>.md, `dir` writes skills/<name>/SKILL.md.
     *
     * @defaultValue `'file'`
     */
    format?: Skill['format'];
    /**
     * False writes `global: false` frontmatter, which hides the skill from the root aggregate.
     *
     * @defaultValue `true`
     */
    global?: boolean;
    /** Tags written to frontmatter, normalized first; an empty list writes no key. */
    tags?: string[];
  }): Promise<Skill> {
    const name = slugSchema.parse(input.name);
    this.requireFreeName(name);
    const format = input.format ?? 'file';
    const relPath = skillPath(format, name);
    const fullPath = path.join(this.skillsDir, relPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    const frontmatter: SkillFrontmatter = {
      name,
      description: input.description,
      ...localFlags({ global: input.global !== false, readOnly: false }),
    };
    const tags = normalizeTags(input.tags);
    if (tags.length > 0) {
      frontmatter.tags = tags;
    }
    const content = serializeMarkdown(frontmatter, input.body);
    await writeTextAtomic(fullPath, content);
    return this.reloadSkill(relPath, format);
  }

  /**
   * Updates a skill's description, body, tags, root visibility and read-only flag in place.
   *
   * @param name - Skill slug.
   * @param patch - The fields to change; an omitted one is kept, and an empty `tags` list clears the key.
   * @returns The updated skill.
   *
   * @remarks
   * Unknown frontmatter keys and the skill's layout are preserved.
   */
  async updateSkill(name: string, patch: Omit<UpdateSkillRequest, 'name'>): Promise<Skill> {
    const existing = this.requireSkill(name);
    // Tags: undefined → keep existing; a list → replace (empty clears the key).
    const nextTags = patch.tags !== undefined ? normalizeTags(patch.tags) : existing.tags;
    const frontmatter: SkillFrontmatter = {
      ...existing.frontmatter,
      name,
      description: patch.description ?? existing.description,
      ...localFlags({
        global: patch.global ?? existing.global,
        readOnly: patch.readOnly ?? existing.readOnly,
      }),
      tags: nextTags.length > 0 ? nextTags : undefined,
    };
    const body = patch.body ?? existing.body;
    const fullPath = path.join(this.skillsDir, existing.path);
    await writeTextAtomic(fullPath, serializeMarkdown(frontmatter, body));
    return this.reloadSkill(existing.path, existing.format);
  }

  /**
   * Renames a skill, moving its file or folder and rewriting the name in its frontmatter.
   *
   * @param name - Current skill slug.
   * @param nextName - The new slug; it must be free.
   * @returns The renamed skill, or the skill untouched when the name is unchanged.
   *
   * @remarks
   * Usage stats and workspace memberships follow the skill to its new name.
   */
  async renameSkill(name: string, nextName: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const target = slugSchema.parse(nextName);
    if (target === name) {
      return existing;
    }
    this.requireFreeName(target, existing);
    const relPath = skillPath(existing.format, target);
    // The frontmatter still carries the old name — rewrite it.
    const renamed = serializeMarkdown(
      { ...existing.frontmatter, name: target, description: existing.description },
      existing.body,
    );
    if (existing.format === 'dir') {
      await this.renameDirSkill(existing, target, renamed);
    } else {
      await this.renameFileSkill(existing, relPath, renamed);
    }
    this.skills.delete(name);
    const reloaded = await this.reloadSkill(relPath, existing.format);
    this.usage.retarget(name, target);
    await this.retargetWorkspaceSkill(name, target);
    return reloaded;
  }

  /**
   * Moves a `dir` skill's folder to its new name and rewrites its SKILL.md there.
   *
   * @param skill - The skill being renamed.
   * @param target - The new slug, which names the folder too, even when the old folder was named otherwise.
   * @param content - The SKILL.md to write, declaring the new name.
   *
   * @remarks
   * The folder is moved back when the SKILL.md cannot be written, so a failed rename changes nothing.
   */
  private async renameDirSkill(skill: Skill, target: string, content: string): Promise<void> {
    const from = this.skillRoot(skill);
    const to = path.join(this.skillsDir, target);
    await rename(from, to);
    try {
      await writeTextAtomic(path.join(to, SKILL_FILE), content);
    } catch (err) {
      await rename(to, from);
      throw err;
    }
  }

  /**
   * Writes a `file` skill under its new file name and removes the old file.
   *
   * @param skill - The skill being renamed.
   * @param relPath - The new file, relative to the skills dir; it may be the file the skill already has.
   * @param content - The document to write, declaring the new name.
   *
   * @remarks
   * The new file is removed again when the old one cannot be, so a failed rename leaves one skill, not two.
   */
  private async renameFileSkill(skill: Skill, relPath: string, content: string): Promise<void> {
    const next = path.join(this.skillsDir, relPath);
    await writeTextAtomic(next, content);
    if (skill.path === relPath) {
      return;
    }
    try {
      await rm(path.join(this.skillsDir, skill.path), { force: true });
    } catch (err) {
      await rm(next, { force: true });
      throw err;
    }
  }

  /**
   * Runs `use` with a fresh folder in the staging area, and removes the folder afterwards.
   *
   * @typeParam T - What `use` resolves to.
   * @param use - Given the folder's absolute path; whatever is still in it afterwards is deleted.
   * @returns What `use` resolved to.
   */
  private async withStagingFolder<T>(use: (work: string) => Promise<T>): Promise<T> {
    await mkdir(this.stagingDir, { recursive: true });
    const work = await mkdtemp(path.join(this.stagingDir, 'stage-'));
    try {
      return await use(work);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /**
   * Points every workspace that lists `from` at `to`, keeping its position in the member list.
   *
   * @param from - The skill's old name.
   * @param to - The skill's new name.
   */
  private async retargetWorkspaceSkill(from: string, to: string): Promise<void> {
    for (const workspace of this.workspacesListing(from)) {
      await this.saveWorkspace({ ...workspace, skills: workspace.skills.map((s) => (s === from ? to : s)) });
    }
  }

  /**
   * Deletes a skill, its supporting files, its usage stats and its workspace memberships.
   *
   * @param name - Skill slug.
   *
   * @remarks
   * The skill's folder or file leaves the skills dir in one move, and is only then forgotten: a delete the
   * disk refuses leaves the skill whole, on disk and in the catalogue.
   */
  async deleteSkill(name: string): Promise<void> {
    const existing = this.requireSkill(name);
    const stored = existing.format === 'dir' ? this.skillRoot(existing) : path.join(this.skillsDir, existing.path);
    await this.withStagingFolder(async (work) => {
      await rename(stored, path.join(work, 'deleted'));
      this.skills.delete(name);
      this.usage.forget(name);
    });
    // Drop the deleted skill from any workspace that referenced it (saveWorkspace prunes it now that it is gone).
    for (const workspace of this.workspacesListing(name)) {
      await this.saveWorkspace(workspace);
    }
  }

  /**
   * Creates a skill from an uploaded `.md`, directory or zip, already unpacked into files.
   *
   * @param input - The name to save under, the layout, and the files with paths relative to the skill's root.
   * @returns The new skill.
   *
   * @remarks
   * Files are written verbatim, except that a skill document declaring another `name` has it rewritten
   * to the chosen one. A `dir` import must include a SKILL.md at its root; a `file` import is exactly
   * one file, written as `<name>.md`.
   */
  async importSkill(input: {
    name: string;
    format: Skill['format'];
    files: { path: string; content: Buffer }[];
  }): Promise<Skill> {
    const name = slugSchema.parse(input.name);
    this.requireFreeName(name);
    if (input.files.length === 0) {
      throw new HttpError(HttpStatus.BadRequest, 'An imported skill must contain at least one file');
    }
    const [only] = input.files;
    if (input.format === 'file') {
      if (input.files.length !== 1 || !only || only.path.toLowerCase().endsWith('.md') === false) {
        throw new HttpError(HttpStatus.BadRequest, 'A file-format skill must contain exactly one Markdown file');
      }
      const relPath = fileSkillPath(name);
      await writeBufferAtomic(path.join(this.skillsDir, relPath), declaringName(only.content, name));
      return this.reloadSkill(relPath, 'file');
    }
    // Validate every path up front (throws on traversal) so a bad entry never leaves a partial dir.
    const entries = input.files.map((file) => ({
      rel: safeRelPath(file.path),
      content: file.content,
    }));
    const hasSkillFile = entries.some((entry) => entry.rel === SKILL_FILE);
    if (hasSkillFile === false) {
      throw new HttpError(HttpStatus.BadRequest, 'A directory skill must include a SKILL.md at its root');
    }
    // Built in the staging area and moved in whole, so a write that fails leaves no half-made skill behind.
    await this.withStagingFolder(async (work) => {
      const dir = path.join(work, 'skill');
      for (const entry of entries) {
        const full = path.join(dir, entry.rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeBufferAtomic(full, entry.rel === SKILL_FILE ? declaringName(entry.content, name) : entry.content);
      }
      await rename(dir, path.join(this.skillsDir, name));
    });
    return this.reloadSkill(dirSkillPath(name), 'dir');
  }

  /**
   * Creates a skill linked to a folder in a git repo, fetching it right away.
   *
   * @param input - The source, plus an optional local name and root visibility.
   * @returns The new, linked skill.
   * @throws HttpError 409 when the name is taken, 400 when the folder has no SKILL.md or yields no name.
   *
   * @remarks
   * A skill given no name takes the upstream frontmatter `name`, else the source folder's (or repo's) name.
   */
  async importSkillFromSource(input: { name?: string; source: GitSource; global?: boolean }): Promise<Skill> {
    return this.sync.withStagedSource(input.source, async (staged) => {
      const name = input.name ?? (await this.sync.sourceSkillName(input.source, staged));
      this.requireFreeName(name);
      return this.sync.exclusiveSync(name, () =>
        this.installStaged(staged, { name, source: input.source, global: input.global !== false, readOnly: false }),
      );
    });
  }

  /**
   * Links an existing skill to a folder in a git repo and replaces its content with that folder.
   *
   * @param name - Skill slug.
   * @param source - Where to fetch the skill from.
   * @returns The skill as synced from the source.
   *
   * @remarks
   * The skill keeps its name, root visibility and read-only flag; a `file` skill becomes a `dir`.
   */
  async linkSkillSource(name: string, source: GitSource): Promise<Skill> {
    this.requireSkill(name);
    return this.sync.exclusiveSync(name, () => this.replaceFromSource(name, source));
  }

  /**
   * Replaces a linked skill's folder with the newest copy from its source.
   *
   * @param name - Skill slug.
   * @returns The synced skill, and whether the source had moved since the last sync.
   * @throws HttpError 400 when the skill is not linked, 409 when it is already syncing.
   */
  async syncSkill(name: string): Promise<{ skill: Skill; changed: boolean }> {
    const linked = this.requireSkill(name).source;
    if (!linked) {
      throw new HttpError(HttpStatus.BadRequest, `Skill "${name}" is not linked to a git source`);
    }
    const source: GitSource = { repo: linked.repo, ref: linked.ref, path: linked.path };
    const skill = await this.sync.exclusiveSync(name, () => this.replaceFromSource(name, source));
    return { skill, changed: skill.source?.commit !== linked.commit };
  }

  /**
   * Drops a skill's git link, leaving its content as last synced and editable again.
   *
   * @param name - Skill slug.
   * @returns The now unlinked skill.
   */
  async unlinkSkillSource(name: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const frontmatter: SkillFrontmatter = { ...existing.frontmatter, source: undefined };
    await writeTextAtomic(path.join(this.skillsDir, existing.path), serializeMarkdown(frontmatter, existing.body));
    return this.reloadSkill(existing.path, existing.format);
  }

  /**
   * Fetches `source` and swaps it in for the skill called `name`, carrying over its local-only settings.
   *
   * @param name - Skill slug.
   * @param source - Where to fetch the skill from.
   * @returns The skill as loaded from the fetched folder.
   */
  private async replaceFromSource(name: string, source: GitSource): Promise<Skill> {
    return this.sync.withStagedSource(source, (staged) => {
      // Looked up after the fetch, so a rename or delete that landed meanwhile is seen.
      const existing = this.requireSkill(name);
      return this.installStaged(staged, {
        name,
        source,
        global: existing.global,
        readOnly: existing.readOnly,
        replaces: existing,
      });
    });
  }

  /**
   * Moves a staged source folder into place and loads the skill it now holds.
   *
   * @param staged - The fetched folder.
   * @param target - The skill it becomes.
   * @returns The loaded skill.
   */
  private async installStaged(staged: StagedSource, target: SyncTarget): Promise<Skill> {
    const folder = await this.sync.installStaged(staged, target);
    return this.reloadSkill(dirSkillPath(folder), 'dir');
  }

  /**
   * Adds or overwrites a supporting file under a skill's folder.
   *
   * @param name - Skill slug.
   * @param relPath - Where to write, relative to the skill's folder; SKILL.md is refused.
   * @param content - The file's bytes.
   * @returns The skill with its file list refreshed.
   *
   * @remarks
   * A `file`-format skill is first promoted to a `dir`: its `.md` becomes `<folder>/SKILL.md`.
   */
  async writeSupportingFile(name: string, relPath: string, content: Buffer): Promise<Skill> {
    const existing = this.requireSkill(name);
    const rel = safeRelPath(relPath);
    requireNotSkillFile(rel);
    await this.ensureDirSkill(existing);
    const full = path.join(this.skillRoot(existing), rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeBufferAtomic(full, content);
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /**
   * Reads one supporting file of a `dir` skill.
   *
   * @param name - Skill slug.
   * @param relPath - The file's path, relative to the skill's folder.
   * @returns The content as UTF-8 text, or as base64 when the file is binary, with its size in bytes.
   */
  async readSupportingFile(name: string, relPath: string): Promise<SkillFileRead> {
    const existing = this.requireSkill(name);
    const rel = this.requireDirRelPath(existing, relPath);
    const full = path.join(this.skillRoot(existing), rel);
    const stats = await statOrUndefined(full);
    if (stats === undefined) {
      throw new HttpError(HttpStatus.NotFound, `No file "${rel}" in skill "${name}"`);
    }
    if (stats.isFile() === false) {
      throw new HttpError(HttpStatus.BadRequest, `"${rel}" is a directory, not a file`);
    }
    const buffer = await readFile(full);
    const binary = isBinary(buffer);
    return {
      path: rel,
      content: buffer.toString(binary ? 'base64' : 'utf8'),
      encoding: binary ? 'base64' : 'utf8',
      size: stats.size,
      binary,
    };
  }

  /**
   * Creates an empty sub-directory under a skill, promoting a `file` skill to a `dir` first.
   *
   * @param name - Skill slug.
   * @param relPath - The folder's path, relative to the skill's folder; nothing may exist there yet.
   * @returns The skill with its file list refreshed.
   */
  async createSupportingFolder(name: string, relPath: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const rel = safeRelPath(relPath);
    requireNotSkillFile(rel);
    await this.ensureDirSkill(existing);
    const full = path.join(this.skillRoot(existing), rel);
    if (existsSync(full)) {
      throw new HttpError(HttpStatus.Conflict, `"${rel}" already exists in skill "${name}"`);
    }
    await mkdir(full, { recursive: true });
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /**
   * Renames or moves a supporting file or folder within a `dir` skill's folder.
   *
   * @param name - Skill slug.
   * @param fromPath - The existing path, relative to the skill's folder.
   * @param toPath - The new path; nothing may exist there yet.
   * @returns The skill with its file list refreshed, or the skill untouched when both paths are the same.
   *
   * @remarks
   * Directories the move leaves empty are removed.
   */
  async moveSupportingPath(name: string, fromPath: string, toPath: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const from = this.requireDirRelPath(existing, fromPath);
    const to = safeRelPath(toPath);
    requireNotSkillFile(to);
    if (from === to) {
      return existing;
    }
    if (to.startsWith(`${from}/`)) {
      throw new HttpError(HttpStatus.BadRequest, 'Cannot move a folder into itself');
    }
    const root = this.skillRoot(existing);
    const fromFull = path.join(root, from);
    const toFull = path.join(root, to);
    if (!existsSync(fromFull)) {
      throw new HttpError(HttpStatus.NotFound, `No file or folder "${from}" in skill "${name}"`);
    }
    if (existsSync(toFull)) {
      throw new HttpError(HttpStatus.Conflict, `"${to}" already exists in skill "${name}"`);
    }
    await mkdir(path.dirname(toFull), { recursive: true });
    await rename(fromFull, toFull);
    await pruneEmptyDirs(path.dirname(fromFull), root);
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /**
   * Deletes one supporting file or folder of a `dir` skill, then removes the directories that leaves empty.
   *
   * @param name - Skill slug.
   * @param relPath - Path relative to the skill's folder; a folder goes with its contents, a missing path is no error.
   * @returns The skill with its file list refreshed.
   */
  async deleteSupportingFile(name: string, relPath: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const rel = this.requireDirRelPath(existing, relPath);
    const root = this.skillRoot(existing);
    const full = path.join(root, rel);
    await rm(full, { recursive: true, force: true });
    await pruneEmptyDirs(path.dirname(full), root);
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /**
   * Zips a skill for download.
   *
   * @param name - Skill slug.
   * @returns The archive: a `dir` skill's files nested under `<name>/`, a `file` skill as a lone `<name>.md`.
   */
  async exportSkillZip(name: string): Promise<Buffer> {
    const existing = this.requireSkill(name);
    const entries: Record<string, Uint8Array> = {};
    if (existing.format === 'file') {
      entries[fileSkillPath(name)] = await readFile(path.join(this.skillsDir, existing.path));
    } else {
      const dir = this.skillRoot(existing);
      for await (const { entry, full } of walkEntries(dir)) {
        if (entry.isFile()) {
          entries[`${name}/${toPosix(path.relative(dir, full))}`] = await readFile(full);
        }
      }
    }
    return Buffer.from(zipSync(entries));
  }

  /**
   * Requires a `dir`-format skill and makes a caller's path within it safe.
   *
   * @param skill - The skill the path belongs to.
   * @param relPath - Caller-supplied path, relative to the skill's folder.
   * @returns The safe relative path. Throws 400 for a `file` skill, an unsafe path or SKILL.md.
   */
  private requireDirRelPath(skill: Skill, relPath: string): string {
    if (skill.format !== 'dir') {
      throw new HttpError(
        HttpStatus.BadRequest,
        `Skill "${skill.name}" is a single file, so it has no supporting files`,
        'writing a supporting file to it turns it into a folder skill',
      );
    }
    const rel = safeRelPath(relPath);
    requireNotSkillFile(rel);
    return rel;
  }

  /**
   * Looks a skill up by name, failing when there is none.
   *
   * @param name - Skill slug.
   * @returns The skill.
   * @throws HttpError 404 when no skill has that name.
   */
  requireSkill(name: string): Skill {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new HttpError(
        HttpStatus.NotFound,
        `Unknown skill "${name}"`,
        'no skill has that name; list the skills to see the names that exist',
      );
    }
    return skill;
  }

  /**
   * Refuses a name that is taken, in the catalogue or as a folder or flat file on disk.
   *
   * @param name - The slug about to be claimed.
   * @param [claimant] - The skill claiming it, whose own folder and file are not a conflict.
   * @throws HttpError 409 when the name or the storage it would use is taken.
   *
   * @remarks
   * A skill's folder need not match its name, so the catalogue alone cannot say a folder is free.
   */
  private requireFreeName(name: string, claimant?: Skill): void {
    const ownStorage = claimant ? [skillFolder(claimant), claimant.path] : [];
    const isStorageTaken = [name, fileSkillPath(name)].some(
      (rel) => ownStorage.includes(rel) === false && existsSync(path.join(this.skillsDir, rel)),
    );
    if (this.skills.has(name) || isStorageTaken) {
      throw new HttpError(HttpStatus.Conflict, `Skill "${name}" already exists`);
    }
  }

  /**
   * Makes sure a skill has a folder to hold supporting files, promoting a `file` skill first.
   *
   * @param skill - The skill about to receive a supporting file or folder.
   */
  private async ensureDirSkill(skill: Skill): Promise<void> {
    if (skill.format === 'file') {
      await this.promoteToDir(skill);
    }
  }

  /**
   * Moves a `file` skill's `.md` to `<folder>/SKILL.md`, which makes it a `dir` skill on disk.
   *
   * @param skill - A `file`-format skill; refused with 409 when its folder already holds a SKILL.md.
   */
  private async promoteToDir(skill: Skill): Promise<void> {
    const fileFull = path.join(this.skillsDir, skill.path);
    const raw = await readFile(fileFull, 'utf8');
    const dir = this.skillRoot(skill);
    if (existsSync(path.join(dir, SKILL_FILE))) {
      throw new HttpError(
        HttpStatus.Conflict,
        `Skill "${skill.name}" cannot take supporting files: the folder "${skillFolder(skill)}" already holds another skill. Rename one of them first.`,
      );
    }
    await mkdir(dir, { recursive: true });
    await writeTextAtomic(path.join(dir, SKILL_FILE), raw);
    await rm(fileFull, { force: true });
  }

  /**
   * Lists every workspace, enabled or not.
   *
   * @returns The workspaces sorted by display name.
   */
  getWorkspaces(): WorkspaceConfig[] {
    return [...this.workspaces.values()].sort(byName);
  }

  /**
   * Looks a workspace up by slug.
   *
   * @param slug - Workspace slug.
   * @returns The workspace, or undefined when there is none.
   */
  getWorkspace(slug: string): WorkspaceConfig | undefined {
    return this.workspaces.get(slug);
  }

  /**
   * Looks a workspace up by slug, failing when there is none.
   *
   * @param slug - Workspace slug.
   * @returns The workspace.
   * @throws HttpError 404 when no workspace has that slug.
   */
  requireWorkspace(slug: string): WorkspaceConfig {
    const workspace = this.workspaces.get(slug);
    if (!workspace) {
      throw new HttpError(HttpStatus.NotFound, `Unknown workspace "${slug}"`, this.knownWorkspaces());
    }
    return workspace;
  }

  /**
   * Finds the workspaces a skill belongs to.
   *
   * @param name - Skill slug.
   * @returns Every workspace whose member list names the skill, sorted by display name.
   */
  private workspacesListing(name: string): WorkspaceConfig[] {
    return this.getWorkspaces().filter((workspace) => workspace.skills.includes(name));
  }

  /**
   * Creates or replaces a workspace and writes its config file.
   *
   * @param config - Workspace to store, keyed by its slug.
   * @returns The stored workspace, with members that no longer exist dropped.
   */
  async saveWorkspace(config: WorkspaceConfig): Promise<WorkspaceConfig> {
    const parsed = workspaceConfigSchema.parse(config);
    // A workspace only lists live skills: silently drop any member that no longer exists.
    const pruned: WorkspaceConfig = { ...parsed, skills: parsed.skills.filter((name) => this.skills.has(name)) };
    this.workspaces.set(pruned.slug, pruned);
    await writeJsonAtomic(this.workspaceFile(pruned.slug), pruned);
    return pruned;
  }

  /**
   * Removes a workspace and its config file.
   *
   * @param slug - Workspace slug.
   * @throws HttpError 404 when no workspace has the slug.
   */
  async deleteWorkspace(slug: string): Promise<void> {
    this.requireWorkspace(slug);
    this.workspaces.delete(slug);
    await rm(this.workspaceFile(slug), { force: true });
    this.workspaceFileNames.delete(slug);
  }

  /**
   * Appends a skill to a workspace's member list; a no-op when it is already listed.
   *
   * @param slug - Workspace slug.
   * @param name - Skill slug; a name no skill has is dropped again on save.
   * @returns The workspace as stored.
   */
  async addSkillToWorkspace(slug: string, name: string): Promise<WorkspaceConfig> {
    const workspace = this.requireWorkspace(slug);
    if (workspace.skills.includes(name)) {
      return workspace;
    }
    return this.saveWorkspace({ ...workspace, skills: [...workspace.skills, name] });
  }

  /**
   * Names the workspaces there are, for the error about one there is not.
   *
   * @returns One clause listing every slug, or saying there are none.
   */
  knownWorkspaces(): string {
    const slugs = this.getWorkspaces().map((workspace) => workspace.slug);
    return slugs.length > 0 ? `the workspaces are ${slugs.join(', ')}` : 'there are no workspaces yet';
  }

  /**
   * Builds the path of a workspace's config file.
   *
   * @param slug - Workspace slug.
   * @returns Absolute path of the file the workspace was loaded from, or of `<slug>.json` for a new one.
   */
  private workspaceFile(slug: string): string {
    return path.join(this.workspacesDir, this.workspaceFileNames.get(slug) ?? `${slug}.json`);
  }

  /**
   * Reads a skill from disk and puts it in the catalogue under its canonical name.
   *
   * @param relPath - The skill document's path, relative to the skills dir.
   * @param format - The skill's layout.
   * @returns The loaded skill.
   */
  private async reloadSkill(relPath: string, format: Skill['format']): Promise<Skill> {
    const skill = await this.readSkill(relPath, format);
    this.skills.set(skill.name, skill);
    return skill;
  }

  /**
   * Resolves a skill's root folder on disk.
   *
   * @param skill - The skill to locate.
   * @returns Absolute path: the folder holding SKILL.md for a `dir` skill, `<skillsDir>/<stem>` for a `file` skill.
   *
   * @remarks
   * A `file` skill gets the folder it would occupy once promoted. The path comes from the stored `path`,
   * so it stays correct when a skill's frontmatter `name` differs from its folder name.
   */
  private skillRoot(skill: Skill): string {
    return path.join(this.skillsDir, skillFolder(skill));
  }

  /**
   * Tells whether an entry of the skills dir is a skill, and where it loads from.
   *
   * @param entry - A direct child of the skills dir.
   * @returns The skill document's path relative to the skills dir and its layout; undefined when it is no skill.
   */
  private skillEntryLocation(entry: Dirent): { relPath: string; format: Skill['format'] } | undefined {
    if (entry.isDirectory()) {
      const relPath = dirSkillPath(entry.name);
      return existsSync(path.join(this.skillsDir, relPath)) ? { relPath, format: 'dir' } : undefined;
    }
    return isMarkdownFile(entry) ? { relPath: entry.name, format: 'file' } : undefined;
  }

  /**
   * Builds the path a `dir` skill loads from, using its real on-disk folder rather than its name.
   *
   * @param skill - The skill to locate.
   * @returns `<folder>/SKILL.md`, relative to the skills dir.
   */
  private dirSkillRelPath(skill: Skill): string {
    return dirSkillPath(skillFolder(skill));
  }

  /** Replaces the in-memory settings, skills and workspaces with what is on disk. */
  private async loadAll(): Promise<void> {
    this.settings = await this.loadSettings();
    this.skills = await this.loadSkills();
    this.workspaces = await this.loadWorkspaces();
  }

  /**
   * Reads settings.json, using the schema defaults when the file is missing.
   *
   * @returns The settings, holding a newly generated auth token when auth is enforced and no token is configured.
   *
   * @remarks
   * A generated token is logged. The file is written when a token was generated or the file was missing.
   */
  private async loadSettings(): Promise<SettingsFile> {
    const file = this.settingsFile;
    const isOnDisk = existsSync(file);
    const loaded = isOnDisk
      ? await parseJsonFile(file, settingsFileSchema.parse.bind(settingsFileSchema))
      : settingsFileSchema.parse({});
    const auth = resolveAuth(loaded);
    const needsGeneratedToken = auth.enabled && auth.token === null;
    const settings = needsGeneratedToken
      ? { ...loaded, authToken: randomBytes(AUTH_TOKEN_BYTES).toString('hex') }
      : loaded;
    if (needsGeneratedToken) {
      console.log(`Generated auth token (persisted to ${file}):\n  ${settings.authToken}`);
    }
    const needsWrite = needsGeneratedToken || isOnDisk === false;
    if (needsWrite) {
      await mkdir(this.configDir, { recursive: true });
      await writeJsonAtomic(file, settings);
    }
    return settings;
  }

  /**
   * Loads every skill in the skills dir.
   *
   * @returns The catalogue, keyed by canonical name.
   *
   * @remarks
   * An invalid skill is logged and skipped, so one broken file cannot fail the load. Of two skills that
   * resolve to one name, the first in sorted order is kept.
   */
  private async loadSkills(): Promise<Map<string, Skill>> {
    const skills = new Map<string, Skill>();
    if (!existsSync(this.skillsDir)) {
      return skills;
    }
    const entries = await readdir(this.skillsDir, { withFileTypes: true });
    for (const entry of entries.sort(byName)) {
      const location = this.skillEntryLocation(entry);
      if (location === undefined) {
        continue;
      }
      const { relPath, format } = location;
      try {
        const skill = await this.readSkill(relPath, format);
        const clash = skills.get(skill.name);
        if (clash) {
          // Two on-disk skills resolved to the same name (e.g. a frontmatter `name` colliding
          // with another folder). Keep the first (sorted) deterministically and skip the rest.
          console.warn(`Ignoring skill at "${relPath}": name "${skill.name}" already provided by "${clash.path}"`);
          continue;
        }
        skills.set(skill.name, skill);
      } catch (err) {
        // A single broken (hand-edited) skill must not take the server down; report and skip it.
        console.error(`Ignoring invalid skill at "${relPath}": ${errorMessage(err)}`);
      }
    }
    return skills;
  }

  /**
   * Reads and validates one skill document.
   *
   * @param relPath - The document's path, relative to the skills dir.
   * @param format - The skill's layout.
   * @returns The skill, with its supporting files listed when it is a `dir` skill.
   *
   * @remarks
   * The name is the frontmatter `name` when that is a valid slug, else the on-disk basename. It throws
   * when neither is a slug.
   */
  private async readSkill(relPath: string, format: Skill['format']): Promise<Skill> {
    const fullPath = path.join(this.skillsDir, relPath);
    const raw = await readFile(fullPath, 'utf8');
    const { frontmatter, body } = parseMarkdown(raw);
    const stats = await stat(fullPath);
    // The on-disk basename: the directory for a `dir` skill, the filename stem for a `file` skill.
    const basename = skillFolder({ path: relPath, format });
    // The declared name is the identity and the folder a storage detail (Agent Skills spec); the
    // on-disk basename is the fallback, so a hand-written flat file without a `name` still loads.
    const declared = typeof frontmatter.name === 'string' ? frontmatter.name : undefined;
    const name = declared && slugSchema.safeParse(declared).success ? declared : basename;
    if (!slugSchema.safeParse(name).success) {
      throw new Error(`name "${name}" is not a valid slug (set a valid \`name\` in the SKILL.md frontmatter)`);
    }
    const files = format === 'dir' ? await this.listSupportingFiles(path.dirname(relPath)) : [];
    return skillSchema.parse({
      name,
      description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
      body,
      frontmatter,
      format,
      // Only an explicit `global: false` hides a skill from the root aggregate; anything else is global.
      global: frontmatter.global !== false,
      readOnly: isReadOnlyFlag(frontmatter.readonly),
      path: relPath,
      updatedAt: stats.mtime.toISOString(),
      files,
      tags: normalizeTags(frontmatter.tags),
      // A malformed hand-edited link is ignored rather than failing the load: the skill is just not linked.
      source: skillSourceSchema.safeParse(frontmatter.source).data,
    });
  }

  /**
   * Lists everything under a skill's folder except its SKILL.md.
   *
   * @param folderRel - The skill's folder, relative to the skills dir.
   * @returns Files and sub-directories with paths relative to that folder, sorted by path; a directory's size is 0.
   */
  private async listSupportingFiles(folderRel: string): Promise<SkillFile[]> {
    const dir = path.join(this.skillsDir, folderRel);
    const out: SkillFile[] = [];
    for await (const { entry, full } of walkEntries(dir)) {
      const rel = toPosix(path.relative(dir, full));
      if (entry.isDirectory()) {
        out.push({ path: rel, type: 'dir', size: 0 });
      } else if (entry.isFile() && rel !== SKILL_FILE) {
        const stats = await stat(full);
        out.push({ path: rel, type: 'file', size: stats.size });
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path, ORDER_LOCALE));
  }

  /**
   * Loads every `*.json` workspace config in the workspaces dir.
   *
   * @returns The workspaces, keyed by slug.
   *
   * @remarks
   * An invalid file is logged and skipped. A config whose slug differs from its file name is kept, with a
   * warning, and its file name is remembered so that saving and deleting it reach that file. When two files
   * declare one slug the first by file name is kept and the other is skipped with a warning.
   */
  private async loadWorkspaces(): Promise<Map<string, WorkspaceConfig>> {
    const workspaces = new Map<string, WorkspaceConfig>();
    this.workspaceFileNames = new Map();
    if (!existsSync(this.workspacesDir)) {
      return workspaces;
    }
    const files = (await readdir(this.workspacesDir)).filter((f) => f.endsWith('.json'));
    for (const file of files.sort()) {
      const fullPath = path.join(this.workspacesDir, file);
      try {
        const config = await parseJsonFile(fullPath, workspaceConfigSchema.parse.bind(workspaceConfigSchema));
        if (`${config.slug}.json` !== file) {
          console.warn(`Workspace config ${fullPath} has slug "${config.slug}" that does not match its filename`);
        }
        const earlier = this.workspaceFileNames.get(config.slug);
        if (earlier !== undefined) {
          console.warn(`Ignoring workspace config ${fullPath}: ${earlier} already declares the slug "${config.slug}"`);
          continue;
        }
        workspaces.set(config.slug, config);
        this.workspaceFileNames.set(config.slug, file);
      } catch (err) {
        console.error(`Ignoring invalid workspace config ${fullPath}: ${errorMessage(err)}`);
      }
    }
    return workspaces;
  }
}
