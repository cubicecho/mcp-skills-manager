import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { type Dirent, existsSync, type Stats } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
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
  HttpStatus,
  isReadOnlyFlag,
  normalizeTags,
  settingsFileSchema,
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
import { fetchGitFolder, type SkillSourceFetcher } from '../sources/git-fetch.ts';
import { SkillSync, type StagedSource, type SyncTarget } from '../sources/skill-sync.ts';
import { parseJsonFile, writeBufferAtomic, writeJsonAtomic, writeTextAtomic } from './atomic-file.ts';
import { migrateLegacyWorkspaces } from './legacy-workspaces.ts';
import { isBinary, pruneEmptyDirs, safeRelPath, toPosix, walkEntries } from './skill-files.ts';
import { dirSkillPath, fileSkillPath, isMarkdownFile, SKILL_FILE, skillFolder, skillPath } from './skill-layout.ts';
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

/**
 * Refuse a path that names the skill's own document, which is not a supporting file.
 * @param rel - Safe path relative to the skill's folder.
 * @param message - What to tell the caller.
 * @throws HttpError 400 when the path is SKILL.md.
 */
function requireNotSkillFile(rel: string, message: string): void {
  if (rel === SKILL_FILE) {
    throw new HttpError(HttpStatus.BadRequest, message);
  }
}

/**
 * Stat a path that may not be there.
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
 * Make an uploaded skill document declare the name it is being saved under. A document that
 * declares another name would load as that skill, shadowing it or hiding the upload.
 * @param content - The uploaded SKILL.md or flat `.md`.
 * @param name - The name the upload was given.
 * @returns The content untouched when it declares no name or this one; else a copy declaring `name`.
 */
function declaringName(content: Buffer, name: string): Buffer {
  const { frontmatter, body } = parseMarkdown(content.toString('utf8'));
  if (frontmatter.name === undefined || frontmatter.name === name) {
    return content;
  }
  return Buffer.from(serializeMarkdown({ ...frontmatter, name }, body));
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
  /** Fetches linked skills from git and swaps them in; it stages under `.sync`, outside the watched dirs. */
  private readonly sync: SkillSync;

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
    this.sync = new SkillSync(
      { skillsDir: this.skillsDir, syncDir: path.join(dataDir, '.sync') },
      options.fetchSource ?? fetchGitFolder,
    );
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

  /** Update an existing skill's description, body, global visibility and/or read-only flag in place, preserving unknown frontmatter and format. */
  async updateSkill(
    name: string,
    patch: { description?: string; body?: string; global?: boolean; readOnly?: boolean; tags?: string[] },
  ): Promise<Skill> {
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

  /** Rename a skill, moving its file or directory. Rejects if the target name is taken. */
  async renameSkill(name: string, nextName: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const target = slugSchema.parse(nextName);
    if (target === name) {
      return existing;
    }
    this.requireFreeName(target, existing);
    const isDir = existing.format === 'dir';
    const relPath = skillPath(existing.format, target);
    if (isDir) {
      // Rename aligns the on-disk folder to the new identity, even if it previously differed.
      await rename(this.skillRoot(existing), path.join(this.skillsDir, target));
    }
    // The frontmatter still carries the old name — rewrite it.
    await writeTextAtomic(
      path.join(this.skillsDir, relPath),
      serializeMarkdown({ ...existing.frontmatter, name: target, description: existing.description }, existing.body),
    );
    const leavesOldFile = isDir === false && existing.path !== relPath;
    if (leavesOldFile) {
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
    for (const workspace of this.workspacesListing(from)) {
      await this.saveWorkspace({ ...workspace, skills: workspace.skills.map((s) => (s === from ? to : s)) });
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
    for (const workspace of this.workspacesListing(name)) {
      await this.saveWorkspace(workspace);
    }
  }

  /**
   * Create a skill from an uploaded .md / directory / zip. Files are written
   * verbatim (frontmatter preserved), except that a skill document declaring
   * another `name` has it rewritten to the chosen one. A `dir` import must include
   * a SKILL.md; a `file` import is a single Markdown file written as `<name>.md`.
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
      if (input.files.length !== 1 || !only) {
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
    const dir = path.join(this.skillsDir, name);
    await mkdir(dir, { recursive: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeBufferAtomic(full, entry.rel === SKILL_FILE ? declaringName(entry.content, name) : entry.content);
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
    return this.sync.withStagedSource(input.source, async (staged) => {
      const name = input.name ?? (await this.sync.sourceSkillName(input.source, staged));
      this.requireFreeName(name);
      return this.sync.exclusiveSync(name, () =>
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
    return this.sync.exclusiveSync(name, () => this.replaceFromSource(name, source));
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
      throw new HttpError(HttpStatus.BadRequest, `Skill "${name}" is not linked to a git source`);
    }
    const source: GitSource = { repo: linked.repo, ref: linked.ref, path: linked.path };
    const skill = await this.sync.exclusiveSync(name, () => this.replaceFromSource(name, source));
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

  /** Move a staged source folder into place and load the skill it now holds. */
  private async installStaged(staged: StagedSource, target: SyncTarget): Promise<Skill> {
    const folder = await this.sync.installStaged(staged, target);
    return this.reloadSkill(dirSkillPath(folder), 'dir');
  }

  /**
   * Add or overwrite a supporting file under a skill's directory. A `file`-format
   * skill is first promoted to a `dir` (its `.md` becomes `<name>/SKILL.md`).
   */
  async writeSupportingFile(name: string, relPath: string, content: Buffer): Promise<Skill> {
    const existing = this.requireSkill(name);
    const rel = safeRelPath(relPath);
    requireNotSkillFile(rel, 'Edit SKILL.md through the skill body, not as a supporting file');
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

  /** Create an empty sub-directory under a skill (promoting a `file` skill to a `dir` first). */
  async createSupportingFolder(name: string, relPath: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const rel = safeRelPath(relPath);
    requireNotSkillFile(rel, 'A folder cannot be named SKILL.md');
    await this.ensureDirSkill(existing);
    const full = path.join(this.skillRoot(existing), rel);
    if (existsSync(full)) {
      throw new HttpError(HttpStatus.Conflict, `"${rel}" already exists in skill "${name}"`);
    }
    await mkdir(full, { recursive: true });
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /** Rename or move a supporting file or folder within a skill's directory. */
  async moveSupportingPath(name: string, fromPath: string, toPath: string): Promise<Skill> {
    const existing = this.requireSkill(name);
    const from = this.requireDirRelPath(existing, fromPath);
    const to = safeRelPath(toPath);
    requireNotSkillFile(to, 'A supporting file cannot be named SKILL.md');
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
      throw new HttpError(HttpStatus.BadRequest, `Skill "${skill.name}" has no supporting files`);
    }
    const rel = safeRelPath(relPath);
    requireNotSkillFile(rel, 'Edit SKILL.md through the skill body, not as a supporting file');
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
      throw new HttpError(HttpStatus.NotFound, `Unknown skill "${name}"`);
    }
    return skill;
  }

  /**
   * Refuse a name that is taken, in the catalogue or as a folder or flat file on disk. A skill's
   * folder need not match its name, so the catalogue alone cannot say a folder is free.
   * @param name - The slug about to be claimed.
   * @param claimant - The skill claiming it, whose own folder and file are not a conflict.
   * @throws HttpError 409 when the name or the storage it would use is taken.
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
   * Look a workspace up by slug, failing when there is none.
   * @param slug - Workspace slug.
   * @returns The workspace.
   * @throws HttpError 404 when no workspace has that slug.
   */
  requireWorkspace(slug: string): WorkspaceConfig {
    const workspace = this.workspaces.get(slug);
    if (!workspace) {
      throw new HttpError(HttpStatus.NotFound, `Unknown workspace "${slug}"`);
    }
    return workspace;
  }

  /**
   * Find the workspaces a skill belongs to.
   * @param name - Skill slug.
   * @returns Every workspace whose member list names the skill, sorted by display name.
   */
  private workspacesListing(name: string): WorkspaceConfig[] {
    return this.getWorkspaces().filter((workspace) => workspace.skills.includes(name));
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
    const workspace = this.requireWorkspace(slug);
    if (workspace.skills.includes(name)) {
      return workspace;
    }
    return this.saveWorkspace({ ...workspace, skills: [...workspace.skills, name] });
  }

  /** Remove a skill from a workspace's member list (no-op if absent or the workspace is gone). */
  async removeSkillFromWorkspace(slug: string, name: string): Promise<void> {
    const workspace = this.workspaces.get(slug);
    const isMember = workspace?.skills.includes(name) === true;
    if (!workspace || isMember === false) {
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

  /**
   * Tell whether an entry of the skills dir is a skill, and where it loads from.
   * @param entry - A direct child of the skills dir.
   * @returns The skill document's path relative to the skills dir and its layout; undefined for
   *   anything else, such as a folder without a SKILL.md.
   */
  private skillEntryLocation(entry: Dirent): { relPath: string; format: Skill['format'] } | undefined {
    if (entry.isDirectory()) {
      const relPath = dirSkillPath(entry.name);
      return existsSync(path.join(this.skillsDir, relPath)) ? { relPath, format: 'dir' } : undefined;
    }
    return isMarkdownFile(entry) ? { relPath: entry.name, format: 'file' } : undefined;
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

  private async loadSkills(): Promise<Map<string, Skill>> {
    const skills = new Map<string, Skill>();
    if (!existsSync(this.skillsDir)) {
      return skills;
    }
    const entries = await readdir(this.skillsDir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
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
        const config = await parseJsonFile(fullPath, workspaceConfigSchema.parse.bind(workspaceConfigSchema));
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
}
