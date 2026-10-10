import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { type Dirent, existsSync } from 'node:fs';
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
  WorkspaceConfig,
} from '@mcp-skills/shared';
import {
  isReadOnlyFlag,
  normalizeTags,
  settingsFileSchema,
  skillSchema,
  skillSourceSchema,
  slugify,
  slugSchema,
  workspaceConfigSchema,
} from '@mcp-skills/shared';
import { type FSWatcher, watch } from 'chokidar';
import { zipSync } from 'fflate';
import { isAuthEffective } from '../auth.ts';
import { errorMessage, HttpError } from '../errors.ts';
import { parseMarkdown, serializeMarkdown } from '../skills/markdown.ts';
import { fetchGitFolder, type SkillSourceFetcher } from '../sources/git-fetch.ts';
import { writeBufferAtomic, writeJsonAtomic, writeTextAtomic } from './atomic-file.ts';
import { migrateLegacyWorkspaces } from './legacy-workspaces.ts';
import { isBinary, pruneEmptyDirs, safeSkillRelPath, toPosix, walkEntries } from './skill-files.ts';
import { dirSkillPath, fileSkillPath, SKILL_FILE, skillFolder } from './skill-layout.ts';
import { STARTER_SKILL, STARTER_WORKSPACE } from './starter-skill.ts';
import { UsageTracker } from './usage-tracker.ts';

/** A point-in-time copy of everything the store holds; the payload of its `change` event. */
export interface ConfigState {
  settings: SettingsFile;
  skills: Skill[];
  workspaces: WorkspaceConfig[];
}

/** Collaborators a store can be built with; the defaults are what production uses. */
export interface ConfigStoreOptions {
  /** Fetches a linked skill's folder from its git source. */
  fetchSource?: SkillSourceFetcher;
}

/** A source folder fetched into the staging area, ready to be moved into place. */
interface StagedSource {
  /** Scratch directory holding the staged folder; removed once the sync finishes. */
  work: string;
  /** The fetched skill folder, with a SKILL.md at its root. */
  dir: string;
  /** Commit the folder was fetched from. */
  commit: string;
}

/** Quiet period in milliseconds after the last file event before the store reloads. */
const WATCH_DEBOUNCE_MS = 300;
/**
 * Tells whether a skills-dir entry is a flat-file skill.
 * @param entry Directory entry to test.
 * @returns True for a regular file named `*.md`.
 */
function isMarkdownFile(entry: Dirent): boolean {
  return entry.isFile() && entry.name.endsWith('.md');
}

/**
 * Owns the flat, hand-editable state under DATA_DIR:
 *  - config/settings.json and config/workspaces/<slug>.json (JSON)
 *  - skills/<name>.md or skills/<name>/SKILL.md (Markdown + YAML frontmatter)
 * All writes are atomic (tmp file + rename). Emits a typed 'change' event when
 * anything changes on disk (debounced chokidar watcher over both trees).
 */
export class ConfigStore extends EventEmitter<{ change: [ConfigState] }> {
  readonly dataDir: string;
  readonly configDir: string;
  readonly workspacesDir: string;
  readonly skillsDir: string;
  /** Absolute path to settings.json. */
  private readonly settingsFile: string;

  private settings: SettingsFile = settingsFileSchema.parse({});
  private skills = new Map<string, Skill>();
  private workspaces = new Map<string, WorkspaceConfig>();
  private watcher: FSWatcher | null = null;
  private watchDebounce: NodeJS.Timeout | null = null;
  /** Usage stats, authoritative in memory once loaded; flushed to usage.json (unwatched) after each record. */
  private readonly usage: UsageTracker;
  /** Absolute path to usage.json — kept at the dataDir root, OUTSIDE the watched dirs, so writes don't trigger reloads. */
  readonly usageFile: string;
  /**
   * Staging area for skills fetched from git. Kept OUTSIDE the watched dirs (a staged SKILL.md
   * under skills/ would load as a skill) but on the same filesystem, so moving a fetched
   * folder into place is a single rename.
   */
  private readonly syncDir: string;
  private readonly fetchSource: SkillSourceFetcher;
  /** Names of skills with a sync or link in flight; a second one is refused rather than interleaved. */
  private readonly syncing = new Set<string>();

  constructor(dataDir: string, options: ConfigStoreOptions = {}) {
    super();
    // Each live stateful-HTTP MCP session subscribes a `change` listener (removed
    // on disconnect), and that count tracks concurrent clients — legitimately
    // unbounded. Disable the default 10-listener leak warning; our sessions
    // reliably unsubscribe, so the count is not a leak signal here.
    this.setMaxListeners(0);
    this.dataDir = dataDir;
    this.configDir = path.join(dataDir, 'config');
    this.workspacesDir = path.join(this.configDir, 'workspaces');
    this.skillsDir = path.join(dataDir, 'skills');
    this.settingsFile = path.join(this.configDir, 'settings.json');
    this.usageFile = path.join(dataDir, 'usage.json');
    this.usage = new UsageTracker(this.usageFile);
    this.syncDir = path.join(dataDir, '.sync');
    this.fetchSource = options.fetchSource ?? fetchGitFolder;
  }

  /** Create directories, seed defaults on first run and load everything. */
  async init(): Promise<void> {
    await mkdir(this.workspacesDir, { recursive: true });
    await mkdir(this.skillsDir, { recursive: true });
    await migrateLegacyWorkspaces(this.configDir, this.workspacesDir);
    await this.loadAll();
    // Usage lives outside the watched dirs and stays authoritative in memory, so it is loaded
    // once here rather than in loadAll() (which reruns on every disk-change reload).
    await this.usage.load();
    await this.seedDefaults();
  }

  /**
   * On a fresh install — no skills and no workspaces on disk — write a starter
   * skill and a workspace that references it, so the server, web UI, and MCP
   * endpoints all have working content to show immediately. Once anything
   * exists (even if the user later deletes it all), this never runs again for
   * that state, so it won't fight a deliberately emptied setup mid-session.
   */
  private async seedDefaults(): Promise<void> {
    if (this.skills.size > 0 || this.workspaces.size > 0) {
      return;
    }
    console.log('No skills or workspaces found; seeding a starter skill and workspace.');
    await this.createSkill(STARTER_SKILL);
    await this.saveWorkspace(workspaceConfigSchema.parse(STARTER_WORKSPACE));
  }

  /** Re-read all state from disk and return the new snapshot. */
  async reload(): Promise<ConfigState> {
    await this.loadAll();
    return this.snapshot();
  }

  /** Start watching config + skills dirs; emits 'change' (debounced) after reloading. */
  startWatching(): void {
    if (this.watcher) {
      return;
    }
    this.watcher = watch([this.configDir, this.skillsDir], { ignoreInitial: true, depth: 3 });
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

  /** Stops the watcher and flushes pending usage counts; call on shutdown. */
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
   * @returns The in-memory settings.json contents.
   */
  getSettings(): SettingsFile {
    return this.settings;
  }

  /** Merge a partial settings update, persist settings.json, and apply it in memory. */
  async updateSettings(patch: Partial<SettingsFile>): Promise<SettingsFile> {
    const next = settingsFileSchema.parse({ ...this.settings, ...patch });
    await writeJsonAtomic(this.settingsFile, next);
    this.settings = next;
    return next;
  }

  /**
   * Lists every skill, global or not.
   * @returns The skills sorted by name.
   */
  getSkills(): Skill[] {
    return [...this.skills.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Skills served on the root `/mcp` aggregate — every skill except those flagged `global: false`. */
  getGlobalSkills(): Skill[] {
    return this.getSkills().filter((skill) => skill.global);
  }

  /** Whether agents may author skills over MCP (settings.authoringEnabled). */
  isAuthoringEnabled(): boolean {
    return this.settings.authoringEnabled;
  }

  /** The authoring tools left out of every MCP endpoint, by name (settings.disabledAuthoringTools). */
  getDisabledAuthoringTools(): string[] {
    return this.settings.disabledAuthoringTools;
  }

  /** How skills are exposed as MCP tools — one tool per skill vs. a single loader tool (settings.skillToolMode). */
  getSkillToolMode(): SettingsFile['skillToolMode'] {
    return this.settings.skillToolMode;
  }

  /** Whether the HTTP `/mcp` endpoints run stateful so they can push live resource updates (settings.httpLiveUpdates). */
  isHttpLiveUpdates(): boolean {
    return this.settings.httpLiveUpdates;
  }

  /** The effective skill-tool mode for a workspace endpoint: its override if set, else the global default. */
  getSkillToolModeForWorkspace(workspace: WorkspaceConfig): SettingsFile['skillToolMode'] {
    return workspace.skillToolMode ?? this.settings.skillToolMode;
  }

  /** The token-free subset of settings exposed over the management API. */
  getSettingsView(): SettingsView {
    return {
      authEnabled: this.settings.authEnabled,
      authoringEnabled: this.settings.authoringEnabled,
      disabledAuthoringTools: this.settings.disabledAuthoringTools,
      skillToolMode: this.settings.skillToolMode,
      httpLiveUpdates: this.settings.httpLiveUpdates,
    };
  }

  /**
   * Looks a skill up by its canonical name.
   * @param name Skill slug.
   * @returns The skill, or undefined when there is none.
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** The skills belonging to a workspace, in the workspace's declared order, skipping any that no longer exist. */
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

  /** Usage stats for a skill (zeros if it has never been loaded). */
  getUsage(name: string): SkillUsage {
    return this.usage.get(name);
  }

  /**
   * Record that a skill's body was loaded over MCP: bump its count and stamp `lastUsedAt`.
   * The write to usage.json is debounced and best-effort — never blocks or fails a load.
   */
  recordSkillUse(name: string): void {
    this.usage.record(name);
  }

  /**
   * Create a new skill. `file` format writes skills/<name>.md; `dir` format
   * writes skills/<name>/SKILL.md. Rejects if the name is already taken.
   */
  async createSkill(input: {
    name: string;
    description: string;
    body: string;
    format?: Skill['format'];
    /** When false, write `global: false` frontmatter so the skill is hidden from the root aggregate. */
    global?: boolean;
    /** Tags/categories to write to frontmatter (normalized on write). */
    tags?: string[];
  }): Promise<Skill> {
    const name = slugSchema.parse(input.name);
    if (this.skills.has(name)) {
      throw new HttpError(409, `Skill "${name}" already exists`);
    }
    const format = input.format ?? 'file';
    const relPath = format === 'dir' ? dirSkillPath(name) : fileSkillPath(name);
    const fullPath = path.join(this.skillsDir, relPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    // Only persist the `global` key when it is false — the true default stays implicit for clean files.
    const frontmatter: SkillFrontmatter = { name, description: input.description };
    if (input.global === false) {
      frontmatter.global = false;
    }
    const tags = normalizeTags(input.tags);
    if (tags.length > 0) {
      frontmatter.tags = tags;
    }
    const content = serializeMarkdown(frontmatter, input.body);
    await writeTextAtomic(fullPath, content);
    return this.reloadSkill(relPath, format);
  }

  /** Update an existing skill's description, body, global visibility and/or read-only flag in place, preserving unknown frontmatter and format. */
  async updateSkill(
    name: string,
    patch: { description?: string; body?: string; global?: boolean; readOnly?: boolean; tags?: string[] },
  ): Promise<Skill> {
    const existing = this.requireSkill(name);
    const nextGlobal = patch.global ?? existing.global;
    const nextReadOnly = patch.readOnly ?? existing.readOnly;
    // Tags: undefined → keep existing; a list → replace (empty clears the key).
    const nextTags = patch.tags !== undefined ? normalizeTags(patch.tags) : existing.tags;
    const frontmatter: SkillFrontmatter = {
      ...existing.frontmatter,
      name,
      description: patch.description ?? existing.description,
      // Persist `global: false` only; drop the key entirely when the skill is (back to) global.
      global: nextGlobal ? undefined : false,
      // Likewise persist `readonly: true` only; drop the key when the skill is writable.
      readonly: nextReadOnly ? true : undefined,
      tags: nextTags.length > 0 ? nextTags : undefined,
    };
    const body = patch.body ?? existing.body;
    const fullPath = path.join(this.skillsDir, existing.path);
    await writeTextAtomic(fullPath, serializeMarkdown(frontmatter, body));
    return this.reloadSkill(existing.path, existing.format);
  }

  /** Rename a skill, moving its file or directory. Rejects if the target name is taken. */
  async renameSkill(name: string, nextName: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const target = slugSchema.parse(nextName);
    if (target === name) {
      return existing;
    }
    if (this.skills.has(target)) {
      throw new HttpError(409, `Skill "${target}" already exists`);
    }
    const isDir = existing.format === 'dir';
    const relPath = isDir ? dirSkillPath(target) : fileSkillPath(target);
    if (isDir) {
      // Rename aligns the on-disk folder to the new identity, even if it previously differed.
      await rename(this.skillRoot(existing), path.join(this.skillsDir, target));
    }
    // The frontmatter still carries the old name — rewrite it.
    await writeTextAtomic(
      path.join(this.skillsDir, relPath),
      serializeMarkdown({ ...existing.frontmatter, name: target, description: existing.description }, existing.body),
    );
    if (!isDir) {
      await rm(path.join(this.skillsDir, existing.path), { force: true });
    }
    this.skills.delete(name);
    const reloaded = await this.reloadSkill(relPath, existing.format);
    this.usage.retarget(name, target);
    await this.retargetWorkspaceSkill(name, target);
    return reloaded;
  }

  /** Point every workspace that listed `from` at `to`, preserving position (used when a skill is renamed). */
  private async retargetWorkspaceSkill(from: string, to: string): Promise<void> {
    for (const workspace of this.getWorkspaces()) {
      if (workspace.skills.includes(from)) {
        await this.saveWorkspace({ ...workspace, skills: workspace.skills.map((s) => (s === from ? to : s)) });
      }
    }
  }

  /**
   * Deletes a skill, its supporting files, its usage stats and its workspace memberships.
   * @param name Skill slug.
   */
  async deleteSkill(name: string): Promise<void> {
    const existing = this.requireSkill(name);
    this.skills.delete(name);
    this.usage.forget(name);
    if (existing.format === 'dir') {
      await rm(this.skillRoot(existing), { recursive: true, force: true });
    } else {
      await rm(path.join(this.skillsDir, existing.path), { force: true });
    }
    // Drop the deleted skill from any workspace that referenced it (saveWorkspace prunes it now that it is gone).
    for (const workspace of this.getWorkspaces()) {
      if (workspace.skills.includes(name)) {
        await this.saveWorkspace(workspace);
      }
    }
  }

  /**
   * Create a skill from an uploaded .md / directory / zip. Files are written
   * verbatim (frontmatter preserved). A `dir` import must include a SKILL.md;
   * a `file` import is a single Markdown file written as `<name>.md`.
   */
  async importSkill(input: {
    name: string;
    format: Skill['format'];
    files: { path: string; content: Buffer }[];
  }): Promise<Skill> {
    const name = slugSchema.parse(input.name);
    if (this.skills.has(name)) {
      throw new HttpError(409, `Skill "${name}" already exists`);
    }
    if (input.files.length === 0) {
      throw new HttpError(400, 'An imported skill must contain at least one file');
    }
    const [only] = input.files;
    if (input.format === 'file') {
      if (input.files.length !== 1 || !only) {
        throw new HttpError(400, 'A file-format skill must contain exactly one Markdown file');
      }
      const relPath = fileSkillPath(name);
      await writeBufferAtomic(path.join(this.skillsDir, relPath), only.content);
      return this.reloadSkill(relPath, 'file');
    }
    // Validate every path up front (throws on traversal) so a bad entry never leaves a partial dir.
    const entries = input.files.map((file) => ({
      rel: safeSkillRelPath(this.skillsDir, name, file.path),
      content: file.content,
    }));
    if (!entries.some((entry) => entry.rel === SKILL_FILE)) {
      throw new HttpError(400, 'A directory skill must include a SKILL.md at its root');
    }
    const dir = path.join(this.skillsDir, name);
    await mkdir(dir, { recursive: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeBufferAtomic(full, entry.content);
    }
    return this.reloadSkill(dirSkillPath(name), 'dir');
  }

  /**
   * Create a skill linked to a folder in a git repo, fetching it right away.
   * @param input The source, plus an optional local name and root visibility. The name defaults to
   *   the upstream frontmatter `name`, else the source folder's (or repo's) name.
   * @returns The new, linked skill.
   * @throws HttpError 409 when the name is taken, 400 when the folder has no SKILL.md or yields no name.
   */
  async importSkillFromSource(input: { name?: string; source: GitSource; global?: boolean }): Promise<Skill> {
    return this.withStagedSource(input.source, async (staged) => {
      const name = input.name ?? (await this.sourceSkillName(input.source, staged));
      if (this.skills.has(name) || existsSync(path.join(this.skillsDir, name))) {
        throw new HttpError(409, `Skill "${name}" already exists`);
      }
      return this.exclusiveSync(name, () =>
        this.installStaged(staged, { name, source: input.source, global: input.global !== false, readOnly: false }),
      );
    });
  }

  /**
   * Link an existing skill to a folder in a git repo and replace its content with that folder.
   * The skill keeps its name, root visibility and read-only flag; a `file` skill becomes a `dir`.
   * @param name Skill slug.
   * @param source Where to fetch the skill from.
   * @returns The skill as synced from the source.
   */
  async linkSkillSource(name: string, source: GitSource): Promise<Skill> {
    this.requireSkill(name);
    return this.exclusiveSync(name, () => this.replaceFromSource(name, source));
  }

  /**
   * Replace a linked skill's folder with the newest copy from its source.
   * @param name Skill slug.
   * @returns The synced skill, and whether the source had moved since the last sync.
   * @throws HttpError 400 when the skill is not linked, 409 when it is already syncing.
   */
  async syncSkill(name: string): Promise<{ skill: Skill; changed: boolean }> {
    const linked = this.requireSkill(name).source;
    if (!linked) {
      throw new HttpError(400, `Skill "${name}" is not linked to a git source`);
    }
    const source: GitSource = { repo: linked.repo, ref: linked.ref, path: linked.path };
    const skill = await this.exclusiveSync(name, () => this.replaceFromSource(name, source));
    return { skill, changed: skill.source?.commit !== linked.commit };
  }

  /**
   * Drop a skill's git link, leaving its content as last synced and editable again.
   * @param name Skill slug.
   * @returns The now unlinked skill.
   */
  async unlinkSkillSource(name: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const frontmatter: SkillFrontmatter = { ...existing.frontmatter, source: undefined };
    await writeTextAtomic(path.join(this.skillsDir, existing.path), serializeMarkdown(frontmatter, existing.body));
    return this.reloadSkill(existing.path, existing.format);
  }

  /** Fetch `source` and swap it in for the skill called `name`, carrying over its local-only settings. */
  private async replaceFromSource(name: string, source: GitSource): Promise<Skill> {
    return this.withStagedSource(source, (staged) => {
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

  /** Run a sync for `name`, refusing a second one while the first is still in flight. */
  private async exclusiveSync<T>(name: string, run: () => Promise<T>): Promise<T> {
    if (this.syncing.has(name)) {
      throw new HttpError(409, `Skill "${name}" is already syncing`);
    }
    this.syncing.add(name);
    try {
      return await run();
    } finally {
      this.syncing.delete(name);
    }
  }

  /** Fetch a source into the staging area, hand it to `use`, and clean the staging area up afterwards. */
  private async withStagedSource<T>(source: GitSource, use: (staged: StagedSource) => Promise<T>): Promise<T> {
    await mkdir(this.syncDir, { recursive: true });
    const work = await mkdtemp(path.join(this.syncDir, 'sync-'));
    try {
      const dir = path.join(work, 'skill');
      await mkdir(dir);
      const { commit } = await this.fetchSource(source, dir);
      if (!existsSync(path.join(dir, SKILL_FILE))) {
        throw new HttpError(400, 'The source folder has no SKILL.md at its root');
      }
      return await use({ work, dir, commit });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /** The name a freshly imported source gets: its declared `name`, else its folder's (or repo's) name. */
  private async sourceSkillName(source: GitSource, staged: StagedSource): Promise<string> {
    const { frontmatter } = parseMarkdown(await readFile(path.join(staged.dir, SKILL_FILE), 'utf8'));
    const declared = slugSchema.safeParse(frontmatter.name);
    if (declared.success) {
      return declared.data;
    }
    const basename = (source.path ?? source.repo.replace(/\.git$/, '')).split(/[/:]/).pop() ?? '';
    const derived = slugSchema.safeParse(slugify(basename));
    if (!derived.success) {
      throw new HttpError(400, 'Could not derive a skill name from the source; give the skill a name');
    }
    return derived.data;
  }

  /**
   * Move a staged source folder into place as the skill `name`. Upstream's SKILL.md is rewritten so
   * the local identity and local-only settings win and the link (with the fetched commit) is recorded.
   */
  private async installStaged(
    staged: StagedSource,
    target: { name: string; source: GitSource; global: boolean; readOnly: boolean; replaces?: Skill },
  ): Promise<Skill> {
    const { name, source, replaces } = target;
    const skillFile = path.join(staged.dir, SKILL_FILE);
    const upstream = parseMarkdown(await readFile(skillFile, 'utf8'));
    const frontmatter: SkillFrontmatter = {
      ...upstream.frontmatter,
      // The local name stays the identity even when upstream declares another, so workspace
      // membership and usage stats never orphan.
      name,
      global: target.global ? undefined : false,
      readonly: target.readOnly ? true : undefined,
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
    return this.reloadSkill(dirSkillPath(folder), 'dir');
  }

  /**
   * Add or overwrite a supporting file under a skill's directory. A `file`-format
   * skill is first promoted to a `dir` (its `.md` becomes `<name>/SKILL.md`).
   */
  async writeSupportingFile(name: string, relPath: string, content: Buffer): Promise<Skill> {
    const existing = this.requireSkill(name);
    const rel = safeSkillRelPath(this.skillsDir, name, relPath);
    if (rel === SKILL_FILE) {
      throw new HttpError(400, 'Edit SKILL.md through the skill body, not as a supporting file');
    }
    await this.ensureDirSkill(existing);
    const full = path.join(this.skillRoot(existing), rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeBufferAtomic(full, content);
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /** Read one supporting file, returning UTF-8 text or, for binary files, base64 bytes. */
  async readSupportingFile(name: string, relPath: string): Promise<SkillFileRead> {
    const existing = this.requireSkill(name);
    const rel = this.requireDirRelPath(existing, relPath);
    const full = path.join(this.skillRoot(existing), rel);
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      stats = await stat(full);
    } catch {
      throw new HttpError(404, `No file "${rel}" in skill "${name}"`);
    }
    if (!stats.isFile()) {
      throw new HttpError(400, `"${rel}" is a directory, not a file`);
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

  /** Create an empty sub-directory under a skill (promoting a `file` skill to a `dir` first). */
  async createSupportingFolder(name: string, relPath: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const rel = safeSkillRelPath(this.skillsDir, name, relPath);
    if (rel === SKILL_FILE) {
      throw new HttpError(400, 'A folder cannot be named SKILL.md');
    }
    await this.ensureDirSkill(existing);
    const full = path.join(this.skillRoot(existing), rel);
    if (existsSync(full)) {
      throw new HttpError(409, `"${rel}" already exists in skill "${name}"`);
    }
    await mkdir(full, { recursive: true });
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /** Rename or move a supporting file or folder within a skill's directory. */
  async moveSupportingPath(name: string, fromPath: string, toPath: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const from = this.requireDirRelPath(existing, fromPath);
    const to = safeSkillRelPath(this.skillsDir, name, toPath);
    if (to === SKILL_FILE) {
      throw new HttpError(400, 'A supporting file cannot be named SKILL.md');
    }
    if (from === to) {
      return existing;
    }
    if (to.startsWith(`${from}/`)) {
      throw new HttpError(400, 'Cannot move a folder into itself');
    }
    const root = this.skillRoot(existing);
    const fromFull = path.join(root, from);
    const toFull = path.join(root, to);
    if (!existsSync(fromFull)) {
      throw new HttpError(404, `No file or folder "${from}" in skill "${name}"`);
    }
    if (existsSync(toFull)) {
      throw new HttpError(409, `"${to}" already exists in skill "${name}"`);
    }
    await mkdir(path.dirname(toFull), { recursive: true });
    await rename(fromFull, toFull);
    await pruneEmptyDirs(path.dirname(fromFull), root);
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /** Delete one supporting file or folder (folders recursively), pruning directories it leaves empty. */
  async deleteSupportingFile(name: string, relPath: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const rel = this.requireDirRelPath(existing, relPath);
    const root = this.skillRoot(existing);
    const full = path.join(root, rel);
    await rm(full, { recursive: true, force: true });
    await pruneEmptyDirs(path.dirname(full), root);
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /** Zip a skill for download: a `dir` skill nested under `<name>/`, a `file` skill as a lone `<name>.md`. */
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

  /** Require a `dir`-format skill and return the safe relative path, rejecting the reserved SKILL.md. */
  private requireDirRelPath(skill: Skill, relPath: string): string {
    if (skill.format !== 'dir') {
      throw new HttpError(400, `Skill "${skill.name}" has no supporting files`);
    }
    const rel = safeSkillRelPath(this.skillsDir, skill.name, relPath);
    if (rel === SKILL_FILE) {
      throw new HttpError(400, 'Edit SKILL.md through the skill body, not as a supporting file');
    }
    return rel;
  }

  /**
   * Look a skill up by name, failing when there is none.
   * @param name - Skill slug.
   * @returns The skill.
   * @throws HttpError 404 when no skill has that name.
   */
  private requireSkill(name: string): Skill {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    return skill;
  }

  /**
   * Make sure a skill has a folder to hold supporting files, promoting a `file` skill first.
   * @param skill - The skill about to receive a supporting file or folder.
   */
  private async ensureDirSkill(skill: Skill): Promise<void> {
    if (skill.format === 'file') {
      await this.promoteToDir(skill);
    }
  }

  /** Move a `file` skill's `.md` to `<folder>/SKILL.md`, converting it to a `dir` skill in place. */
  private async promoteToDir(skill: Skill): Promise<void> {
    const fileFull = path.join(this.skillsDir, skill.path);
    const raw = await readFile(fileFull, 'utf8');
    const dir = this.skillRoot(skill);
    await mkdir(dir, { recursive: true });
    await writeTextAtomic(path.join(dir, SKILL_FILE), raw);
    await rm(fileFull, { force: true });
  }

  /**
   * Lists every workspace, enabled or not.
   * @returns The workspaces sorted by display name.
   */
  getWorkspaces(): WorkspaceConfig[] {
    return [...this.workspaces.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Looks a workspace up by slug.
   * @param slug Workspace slug.
   * @returns The workspace, or undefined when there is none.
   */
  getWorkspace(slug: string): WorkspaceConfig | undefined {
    return this.workspaces.get(slug);
  }

  /**
   * Creates or replaces a workspace and writes its config file.
   * @param config Workspace to store, keyed by its slug.
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
   * Removes a workspace and its config file; a no-op for an unknown slug.
   * @param slug Workspace slug.
   */
  async deleteWorkspace(slug: string): Promise<void> {
    this.workspaces.delete(slug);
    await rm(this.workspaceFile(slug), { force: true });
  }

  /** Append a skill to a workspace's member list (idempotent). Used when an agent authors a skill via a workspace endpoint. */
  async addSkillToWorkspace(slug: string, name: string): Promise<WorkspaceConfig> {
    const workspace = this.workspaces.get(slug);
    if (!workspace) {
      throw new HttpError(404, `Unknown workspace "${slug}"`);
    }
    if (workspace.skills.includes(name)) {
      return workspace;
    }
    return this.saveWorkspace({ ...workspace, skills: [...workspace.skills, name] });
  }

  /** Remove a skill from a workspace's member list (no-op if absent or the workspace is gone). */
  async removeSkillFromWorkspace(slug: string, name: string): Promise<void> {
    const workspace = this.workspaces.get(slug);
    if (!workspace || !workspace.skills.includes(name)) {
      return;
    }
    await this.saveWorkspace({ ...workspace, skills: workspace.skills.filter((s) => s !== name) });
  }

  private workspaceFile(slug: string): string {
    return path.join(this.workspacesDir, `${slug}.json`);
  }

  private async reloadSkill(relPath: string, format: Skill['format']): Promise<Skill> {
    const skill = await this.readSkill(relPath, format);
    this.skills.set(skill.name, skill);
    return skill;
  }

  /**
   * A skill's on-disk root folder (absolute). For a `dir` skill this is the directory holding its
   * SKILL.md; for a `file` skill it is the directory it would occupy once promoted (skillsDir/<stem>).
   * Derived from the stored `path`, so it stays correct when a skill's identity (frontmatter `name`)
   * differs from its folder name.
   */
  private skillRoot(skill: Skill): string {
    return path.join(this.skillsDir, skillFolder(skill));
  }

  /** The `<folder>/SKILL.md` relative path a `dir` skill loads from — using its real on-disk folder, not its name. */
  private dirSkillRelPath(skill: Skill): string {
    return dirSkillPath(skillFolder(skill));
  }

  private async loadAll(): Promise<void> {
    this.settings = await this.loadSettings();
    this.skills = await this.loadSkills();
    this.workspaces = await this.loadWorkspaces();
  }

  private async loadSettings(): Promise<SettingsFile> {
    const file = this.settingsFile;
    let settings: SettingsFile;
    let dirty = false;
    if (existsSync(file)) {
      settings = this.parseJson(file, await readFile(file, 'utf8'), settingsFileSchema.parse.bind(settingsFileSchema));
    } else {
      settings = settingsFileSchema.parse({});
      dirty = true;
    }
    const hasToken = Boolean(settings.authToken || process.env.MCP_SKILLS_TOKEN);
    const needsGeneratedToken = isAuthEffective(settings) && !hasToken;
    if (needsGeneratedToken) {
      settings.authToken = randomBytes(32).toString('hex');
      dirty = true;
      console.log(`Generated auth token (persisted to ${file}):\n  ${settings.authToken}`);
    }
    if (dirty) {
      await mkdir(this.configDir, { recursive: true });
      await writeJsonAtomic(file, settings);
    }
    return settings;
  }

  private async loadSkills(): Promise<Map<string, Skill>> {
    const skills = new Map<string, Skill>();
    if (!existsSync(this.skillsDir)) {
      return skills;
    }
    const entries = await readdir(this.skillsDir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      let relPath: string;
      let format: Skill['format'];
      if (entry.isDirectory()) {
        relPath = dirSkillPath(entry.name);
        if (!existsSync(path.join(this.skillsDir, relPath))) {
          continue; // a directory without a SKILL.md is not a skill
        }
        format = 'dir';
      } else if (isMarkdownFile(entry)) {
        relPath = entry.name;
        format = 'file';
      } else {
        continue;
      }
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

  private async readSkill(relPath: string, format: Skill['format']): Promise<Skill> {
    const fullPath = path.join(this.skillsDir, relPath);
    const raw = await readFile(fullPath, 'utf8');
    const { frontmatter, body } = parseMarkdown(raw);
    const stats = await stat(fullPath);
    // The on-disk basename: the directory for a `dir` skill, the filename stem for a `file` skill.
    const basename = skillFolder({ path: relPath, format });
    // Canonical identity is the frontmatter `name` when it is a valid slug (Agent Skills spec:
    // the folder is a storage detail, the declared name is the skill's identity). Fall back to the
    // on-disk basename so hand-written flat files without a `name` still load.
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

  /** Every entry under a skill's folder (relative to skillsDir) except its SKILL.md — files and sub-dirs, paths relative to that folder. */
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
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async loadWorkspaces(): Promise<Map<string, WorkspaceConfig>> {
    const workspaces = new Map<string, WorkspaceConfig>();
    if (!existsSync(this.workspacesDir)) {
      return workspaces;
    }
    const files = (await readdir(this.workspacesDir)).filter((f) => f.endsWith('.json'));
    for (const file of files.sort()) {
      const fullPath = path.join(this.workspacesDir, file);
      try {
        const config = this.parseJson(
          fullPath,
          await readFile(fullPath, 'utf8'),
          workspaceConfigSchema.parse.bind(workspaceConfigSchema),
        );
        if (`${config.slug}.json` !== file) {
          console.warn(`Workspace config ${fullPath} has slug "${config.slug}" that does not match its filename`);
        }
        workspaces.set(config.slug, config);
      } catch (err) {
        console.error(`Ignoring invalid workspace config ${fullPath}: ${errorMessage(err)}`);
      }
    }
    return workspaces;
  }

  private parseJson<T>(file: string, raw: string, parse: (value: unknown) => T): T {
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
}
