import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ProfileConfig,
  SettingsFile,
  SettingsView,
  Skill,
  SkillFile,
  SkillFileRead,
  SkillFrontmatter,
  SkillUsage,
} from '@mcp-skills/shared';
import {
  normalizeTags,
  profileConfigSchema,
  settingsFileSchema,
  skillNameSchema,
  skillSchema,
  skillUsageSchema,
} from '@mcp-skills/shared';
import { type FSWatcher, watch } from 'chokidar';
import { zipSync } from 'fflate';
import { authDisabledByEnv } from '../auth.ts';
import { errorMessage, HttpError } from '../errors.ts';
import { parseMarkdown, serializeMarkdown } from '../skills/markdown.ts';

export interface ConfigState {
  settings: SettingsFile;
  skills: Skill[];
  profiles: ProfileConfig[];
}

const WATCH_DEBOUNCE_MS = 300;
/** Coalesce bursts of skill loads into one usage.json write. */
const USAGE_FLUSH_MS = 500;

/** Normalize an OS-native path (which may use `\` on Windows) to a POSIX-style relative path. */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Heuristic: a file is binary if it holds a NUL byte or is not decodable as UTF-8. */
function isBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return true;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return false;
  } catch {
    return true;
  }
}

/** Body of the starter skill written on a fresh install (see seedDefaults). */
const GETTING_STARTED_BODY = `# Getting started

Welcome to **MCP Skills Manager**. This is a starter skill, created automatically
because your data directory was empty. Feel free to edit or delete it.

## What a skill is

A skill is a Markdown document that an agent can load over MCP. Each skill is
served two ways at once:

- as an MCP **tool** — calling it returns this Markdown body;
- as an MCP **resource** at \`skill://<name>\`.

## Authoring skills

Skills live under \`DATA_DIR/skills\` in one of two shapes:

- a flat file: \`skills/<name>.md\`
- a directory: \`skills/<name>/SKILL.md\` plus any supporting files

Both start with YAML frontmatter carrying \`name\` and \`description\`, followed by
the Markdown body. Edit them here in the web UI, or on disk — changes are picked
up automatically.

## Profiles

Group a subset of skills into a **profile** to serve them at their own endpoint,
\`/mcp/p/<slug>\`. This skill belongs to the seeded "Examples" profile.
`;

/**
 * Owns the flat, hand-editable state under DATA_DIR:
 *  - config/settings.json and config/profiles/<slug>.json (JSON)
 *  - skills/<name>.md or skills/<name>/SKILL.md (Markdown + YAML frontmatter)
 * All writes are atomic (tmp file + rename). Emits a typed 'change' event when
 * anything changes on disk (debounced chokidar watcher over both trees).
 */
export class ConfigStore extends EventEmitter<{ change: [ConfigState] }> {
  readonly dataDir: string;
  readonly configDir: string;
  readonly profilesDir: string;
  readonly skillsDir: string;

  private settings: SettingsFile = settingsFileSchema.parse({});
  private skills = new Map<string, Skill>();
  private profiles = new Map<string, ProfileConfig>();
  private watcher: FSWatcher | null = null;
  private watchDebounce: NodeJS.Timeout | null = null;
  /** In-memory usage stats, authoritative once loaded; flushed to usage.json (unwatched) after each record. */
  private usage = new Map<string, SkillUsage>();
  private usageFlush: NodeJS.Timeout | null = null;
  /** Absolute path to usage.json — kept at the dataDir root, OUTSIDE the watched dirs, so writes don't trigger reloads. */
  readonly usageFile: string;

  constructor(dataDir: string) {
    super();
    this.dataDir = dataDir;
    this.configDir = path.join(dataDir, 'config');
    this.profilesDir = path.join(this.configDir, 'profiles');
    this.skillsDir = path.join(dataDir, 'skills');
    this.usageFile = path.join(dataDir, 'usage.json');
  }

  /** Create directories, seed defaults on first run and load everything. */
  async init(): Promise<void> {
    await mkdir(this.profilesDir, { recursive: true });
    await mkdir(this.skillsDir, { recursive: true });
    await this.loadAll();
    // Usage lives outside the watched dirs and stays authoritative in memory, so it is loaded
    // once here rather than in loadAll() (which reruns on every disk-change reload).
    this.usage = await this.loadUsage();
    await this.seedDefaults();
  }

  /**
   * On a fresh install — no skills and no profiles on disk — write a starter
   * skill and a profile that references it, so the server, web UI, and MCP
   * endpoints all have working content to show immediately. Once anything
   * exists (even if the user later deletes it all), this never runs again for
   * that state, so it won't fight a deliberately emptied setup mid-session.
   */
  private async seedDefaults(): Promise<void> {
    if (this.skills.size > 0 || this.profiles.size > 0) {
      return;
    }
    console.log('No skills or profiles found; seeding a starter skill and profile.');
    await this.createSkill({
      name: 'getting-started',
      description: 'How MCP Skills Manager works and how to author your own skills.',
      body: GETTING_STARTED_BODY,
    });
    await this.saveProfile(
      profileConfigSchema.parse({
        name: 'Examples',
        slug: 'examples',
        description: 'A starter profile. Edit or delete it once you add your own skills.',
        skills: ['getting-started'],
      }),
    );
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

  async close(): Promise<void> {
    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
    // Flush any pending usage write so counts survive a graceful shutdown.
    if (this.usageFlush) {
      clearTimeout(this.usageFlush);
      this.usageFlush = null;
      await this.flushUsage().catch(() => {});
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  snapshot(): ConfigState {
    return {
      settings: this.settings,
      skills: this.getSkills(),
      profiles: this.getProfiles(),
    };
  }

  getSettings(): SettingsFile {
    return this.settings;
  }

  /** Merge a partial settings update, persist settings.json, and apply it in memory. */
  async updateSettings(patch: Partial<SettingsFile>): Promise<SettingsFile> {
    const next = settingsFileSchema.parse({ ...this.settings, ...patch });
    await this.writeJsonAtomic(path.join(this.configDir, 'settings.json'), next);
    this.settings = next;
    return next;
  }

  // --- skills ---

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

  /** How skills are exposed as MCP tools — one tool per skill vs. a single loader tool (settings.skillToolMode). */
  getSkillToolMode(): SettingsFile['skillToolMode'] {
    return this.settings.skillToolMode;
  }

  /** The effective skill-tool mode for a profile endpoint: its override if set, else the global default. */
  getSkillToolModeForProfile(profile: ProfileConfig): SettingsFile['skillToolMode'] {
    return profile.skillToolMode ?? this.settings.skillToolMode;
  }

  /** The token-free subset of settings exposed over the management API. */
  getSettingsView(): SettingsView {
    return {
      authEnabled: this.settings.authEnabled,
      authoringEnabled: this.settings.authoringEnabled,
      skillToolMode: this.settings.skillToolMode,
    };
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** The skills belonging to a profile, in the profile's declared order, skipping any that no longer exist. */
  getSkillsForProfile(profile: ProfileConfig): Skill[] {
    const seen = new Set<string>();
    const result: Skill[] = [];
    for (const name of profile.skills) {
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

  // --- usage analytics ---

  /** Usage stats for a skill (zeros if it has never been loaded). */
  getUsage(name: string): SkillUsage {
    return this.usage.get(name) ?? { count: 0, lastUsedAt: null };
  }

  /**
   * Record that a skill's body was loaded over MCP: bump its count and stamp `lastUsedAt`.
   * The write to usage.json is debounced and best-effort — never blocks or fails a load.
   */
  recordSkillUse(name: string): void {
    const prev = this.usage.get(name);
    this.usage.set(name, { count: (prev?.count ?? 0) + 1, lastUsedAt: new Date().toISOString() });
    this.scheduleUsageFlush();
  }

  private scheduleUsageFlush(): void {
    if (this.usageFlush) {
      return;
    }
    this.usageFlush = setTimeout(() => {
      this.usageFlush = null;
      this.flushUsage().catch((err: unknown) => {
        console.error(`Persisting skill usage failed: ${errorMessage(err)}`);
      });
    }, USAGE_FLUSH_MS);
  }

  private async flushUsage(): Promise<void> {
    await this.writeJsonAtomic(this.usageFile, Object.fromEntries(this.usage));
  }

  private async loadUsage(): Promise<Map<string, SkillUsage>> {
    if (!existsSync(this.usageFile)) {
      return new Map();
    }
    try {
      const parsed = JSON.parse(await readFile(this.usageFile, 'utf8')) as Record<string, unknown>;
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
    const name = skillNameSchema.parse(input.name);
    if (this.skills.has(name)) {
      throw new HttpError(409, `Skill "${name}" already exists`);
    }
    const format = input.format ?? 'file';
    const relPath = format === 'dir' ? path.join(name, 'SKILL.md') : `${name}.md`;
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
    await this.writeTextAtomic(fullPath, content);
    return this.reloadSkill(relPath, format);
  }

  /** Update an existing skill's description, body and/or global visibility in place, preserving unknown frontmatter and format. */
  async updateSkill(
    name: string,
    patch: { description?: string; body?: string; global?: boolean; tags?: string[] },
  ): Promise<Skill> {
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    const nextGlobal = patch.global ?? existing.global;
    // Tags: undefined → keep existing; a list → replace (empty clears the key).
    const nextTags = patch.tags !== undefined ? normalizeTags(patch.tags) : existing.tags;
    const frontmatter: SkillFrontmatter = {
      ...existing.frontmatter,
      name,
      description: patch.description ?? existing.description,
      // Persist `global: false` only; drop the key entirely when the skill is (back to) global.
      global: nextGlobal ? undefined : false,
      tags: nextTags.length > 0 ? nextTags : undefined,
    };
    const body = patch.body ?? existing.body;
    const fullPath = path.join(this.skillsDir, existing.path);
    await this.writeTextAtomic(fullPath, serializeMarkdown(frontmatter, body));
    return this.reloadSkill(existing.path, existing.format);
  }

  /** Rename a skill, moving its file or directory. Rejects if the target name is taken. */
  async renameSkill(name: string, nextName: string): Promise<Skill> {
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    const target = skillNameSchema.parse(nextName);
    if (target === name) {
      return existing;
    }
    if (this.skills.has(target)) {
      throw new HttpError(409, `Skill "${target}" already exists`);
    }
    if (existing.format === 'dir') {
      // Rename aligns the on-disk folder to the new identity, even if it previously differed.
      const from = this.skillRoot(existing);
      const to = path.join(this.skillsDir, target);
      await rename(from, to);
      const relPath = path.join(target, 'SKILL.md');
      // The SKILL.md frontmatter still carries the old name — rewrite it.
      await this.writeTextAtomic(
        path.join(this.skillsDir, relPath),
        serializeMarkdown({ ...existing.frontmatter, name: target, description: existing.description }, existing.body),
      );
      this.skills.delete(name);
      const reloaded = await this.reloadSkill(relPath, 'dir');
      this.retargetUsage(name, target);
      await this.retargetProfileSkill(name, target);
      return reloaded;
    }
    const relPath = `${target}.md`;
    await this.writeTextAtomic(
      path.join(this.skillsDir, relPath),
      serializeMarkdown({ ...existing.frontmatter, name: target, description: existing.description }, existing.body),
    );
    await rm(path.join(this.skillsDir, existing.path), { force: true });
    this.skills.delete(name);
    const reloaded = await this.reloadSkill(relPath, 'file');
    this.retargetUsage(name, target);
    await this.retargetProfileSkill(name, target);
    return reloaded;
  }

  /** Carry a skill's usage stats over to its new name on rename, so history is not lost. */
  private retargetUsage(from: string, to: string): void {
    const stats = this.usage.get(from);
    if (stats) {
      this.usage.delete(from);
      this.usage.set(to, stats);
      this.scheduleUsageFlush();
    }
  }

  /** Point every profile that listed `from` at `to`, preserving position (used when a skill is renamed). */
  private async retargetProfileSkill(from: string, to: string): Promise<void> {
    for (const profile of this.getProfiles()) {
      if (profile.skills.includes(from)) {
        await this.saveProfile({ ...profile, skills: profile.skills.map((s) => (s === from ? to : s)) });
      }
    }
  }

  async deleteSkill(name: string): Promise<void> {
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    this.skills.delete(name);
    if (this.usage.delete(name)) {
      this.scheduleUsageFlush();
    }
    if (existing.format === 'dir') {
      await rm(this.skillRoot(existing), { recursive: true, force: true });
    } else {
      await rm(path.join(this.skillsDir, existing.path), { force: true });
    }
    // Drop the deleted skill from any profile that referenced it (saveProfile prunes it now that it is gone).
    for (const profile of this.getProfiles()) {
      if (profile.skills.includes(name)) {
        await this.saveProfile(profile);
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
    const name = skillNameSchema.parse(input.name);
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
      const relPath = `${name}.md`;
      await this.writeBufferAtomic(path.join(this.skillsDir, relPath), only.content);
      return this.reloadSkill(relPath, 'file');
    }
    // Validate every path up front (throws on traversal) so a bad entry never leaves a partial dir.
    const entries = input.files.map((file) => ({ rel: this.safeSkillRelPath(name, file.path), content: file.content }));
    if (!entries.some((entry) => entry.rel === 'SKILL.md')) {
      throw new HttpError(400, 'A directory skill must include a SKILL.md at its root');
    }
    const dir = path.join(this.skillsDir, name);
    await mkdir(dir, { recursive: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.rel);
      await mkdir(path.dirname(full), { recursive: true });
      await this.writeBufferAtomic(full, entry.content);
    }
    return this.reloadSkill(path.join(name, 'SKILL.md'), 'dir');
  }

  /**
   * Add or overwrite a supporting file under a skill's directory. A `file`-format
   * skill is first promoted to a `dir` (its `.md` becomes `<name>/SKILL.md`).
   */
  async writeSupportingFile(name: string, relPath: string, content: Buffer): Promise<Skill> {
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    const rel = this.safeSkillRelPath(name, relPath);
    if (rel === 'SKILL.md') {
      throw new HttpError(400, 'Edit SKILL.md through the skill body, not as a supporting file');
    }
    if (existing.format === 'file') {
      await this.promoteToDir(existing);
    }
    const full = path.join(this.skillRoot(existing), rel);
    await mkdir(path.dirname(full), { recursive: true });
    await this.writeBufferAtomic(full, content);
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /** Read one supporting file, returning UTF-8 text or, for binary files, base64 bytes. */
  async readSupportingFile(name: string, relPath: string): Promise<SkillFileRead> {
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
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
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    const rel = this.safeSkillRelPath(name, relPath);
    if (rel === 'SKILL.md') {
      throw new HttpError(400, 'A folder cannot be named SKILL.md');
    }
    if (existing.format === 'file') {
      await this.promoteToDir(existing);
    }
    const full = path.join(this.skillRoot(existing), rel);
    if (existsSync(full)) {
      throw new HttpError(409, `"${rel}" already exists in skill "${name}"`);
    }
    await mkdir(full, { recursive: true });
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /** Rename or move a supporting file or folder within a skill's directory. */
  async moveSupportingPath(name: string, fromPath: string, toPath: string): Promise<Skill> {
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    const from = this.requireDirRelPath(existing, fromPath);
    const to = this.safeSkillRelPath(name, toPath);
    if (to === 'SKILL.md') {
      throw new HttpError(400, 'A supporting file cannot be named SKILL.md');
    }
    if (from === to) {
      return existing;
    }
    if (to === from || to.startsWith(`${from}/`)) {
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
    await this.pruneEmptyDirs(path.dirname(fromFull), root);
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /** Delete one supporting file or folder (folders recursively), pruning directories it leaves empty. */
  async deleteSupportingFile(name: string, relPath: string): Promise<Skill> {
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    const rel = this.requireDirRelPath(existing, relPath);
    const root = this.skillRoot(existing);
    const full = path.join(root, rel);
    await rm(full, { recursive: true, force: true });
    await this.pruneEmptyDirs(path.dirname(full), root);
    return this.reloadSkill(this.dirSkillRelPath(existing), 'dir');
  }

  /** Zip a skill for download: a `dir` skill nested under `<name>/`, a `file` skill as a lone `<name>.md`. */
  async exportSkillZip(name: string): Promise<Buffer> {
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    const entries: Record<string, Uint8Array> = {};
    if (existing.format === 'file') {
      entries[`${name}.md`] = await readFile(path.join(this.skillsDir, existing.path));
    } else {
      const dir = this.skillRoot(existing);
      const collect = async (current: string): Promise<void> => {
        for (const entry of await readdir(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            await collect(full);
          } else if (entry.isFile()) {
            entries[`${name}/${toPosix(path.relative(dir, full))}`] = await readFile(full);
          }
        }
      };
      await collect(dir);
    }
    return Buffer.from(zipSync(entries));
  }

  /** Require a `dir`-format skill and return the safe relative path, rejecting the reserved SKILL.md. */
  private requireDirRelPath(skill: Skill, relPath: string): string {
    if (skill.format !== 'dir') {
      throw new HttpError(400, `Skill "${skill.name}" has no supporting files`);
    }
    const rel = this.safeSkillRelPath(skill.name, relPath);
    if (rel === 'SKILL.md') {
      throw new HttpError(400, 'Edit SKILL.md through the skill body, not as a supporting file');
    }
    return rel;
  }

  /** Move a `file` skill's `.md` to `<folder>/SKILL.md`, converting it to a `dir` skill in place. */
  private async promoteToDir(skill: Skill): Promise<void> {
    const fileFull = path.join(this.skillsDir, skill.path);
    const raw = await readFile(fileFull, 'utf8');
    const dir = this.skillRoot(skill);
    await mkdir(dir, { recursive: true });
    await this.writeTextAtomic(path.join(dir, 'SKILL.md'), raw);
    await rm(fileFull, { force: true });
  }

  /**
   * Resolve a caller-supplied path within a skill's directory, rejecting absolute
   * paths and `..` traversal. Returns the safe POSIX-style relative path.
   */
  private safeSkillRelPath(name: string, relPath: string): string {
    const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const skillDir = path.join(this.skillsDir, name);
    const full = path.resolve(skillDir, cleaned);
    const rel = path.relative(skillDir, full);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new HttpError(400, `Unsafe file path "${relPath}"`, 'paths must stay within the skill directory');
    }
    return rel.split(path.sep).join('/');
  }

  /** Remove now-empty directories from `dir` up to (but not including) `stopAt`. */
  private async pruneEmptyDirs(dir: string, stopAt: string): Promise<void> {
    let current = dir;
    while (current !== stopAt && current.startsWith(stopAt + path.sep)) {
      const remaining = await readdir(current);
      if (remaining.length > 0) {
        break;
      }
      await rm(current, { recursive: true, force: true });
      current = path.dirname(current);
    }
  }

  // --- profiles ---

  getProfiles(): ProfileConfig[] {
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getProfile(slug: string): ProfileConfig | undefined {
    return this.profiles.get(slug);
  }

  async saveProfile(config: ProfileConfig): Promise<ProfileConfig> {
    const parsed = profileConfigSchema.parse(config);
    // A profile only lists live skills: silently drop any member that no longer exists.
    const pruned: ProfileConfig = { ...parsed, skills: parsed.skills.filter((name) => this.skills.has(name)) };
    this.profiles.set(pruned.slug, pruned);
    await this.writeJsonAtomic(this.profileFile(pruned.slug), pruned);
    return pruned;
  }

  async deleteProfile(slug: string): Promise<void> {
    this.profiles.delete(slug);
    await rm(this.profileFile(slug), { force: true });
  }

  /** Append a skill to a profile's member list (idempotent). Used when an agent authors a skill via a profile endpoint. */
  async addSkillToProfile(slug: string, name: string): Promise<ProfileConfig> {
    const profile = this.profiles.get(slug);
    if (!profile) {
      throw new HttpError(404, `Unknown profile "${slug}"`);
    }
    if (profile.skills.includes(name)) {
      return profile;
    }
    return this.saveProfile({ ...profile, skills: [...profile.skills, name] });
  }

  /** Remove a skill from a profile's member list (no-op if absent or the profile is gone). */
  async removeSkillFromProfile(slug: string, name: string): Promise<void> {
    const profile = this.profiles.get(slug);
    if (!profile || !profile.skills.includes(name)) {
      return;
    }
    await this.saveProfile({ ...profile, skills: profile.skills.filter((s) => s !== name) });
  }

  // --- internals ---

  private profileFile(slug: string): string {
    return path.join(this.profilesDir, `${slug}.json`);
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
    const folder = skill.format === 'dir' ? path.dirname(skill.path) : skill.path.slice(0, -'.md'.length);
    return path.join(this.skillsDir, folder);
  }

  /** The `<folder>/SKILL.md` relative path a `dir` skill loads from — using its real on-disk folder, not its name. */
  private dirSkillRelPath(skill: Skill): string {
    const folder = skill.format === 'dir' ? path.dirname(skill.path) : skill.path.slice(0, -'.md'.length);
    return path.join(folder, 'SKILL.md');
  }

  private async loadAll(): Promise<void> {
    this.settings = await this.loadSettings();
    this.skills = await this.loadSkills();
    this.profiles = await this.loadProfiles();
  }

  private async loadSettings(): Promise<SettingsFile> {
    const file = path.join(this.configDir, 'settings.json');
    let settings: SettingsFile;
    let dirty = false;
    if (existsSync(file)) {
      settings = this.parseJson(file, await readFile(file, 'utf8'), settingsFileSchema.parse.bind(settingsFileSchema));
    } else {
      settings = settingsFileSchema.parse({});
      dirty = true;
    }
    if (settings.authEnabled && !authDisabledByEnv() && !settings.authToken && !process.env.MCP_SKILLS_TOKEN) {
      settings.authToken = randomBytes(32).toString('hex');
      dirty = true;
      console.log(`Generated auth token (persisted to ${file}):\n  ${settings.authToken}`);
    }
    if (dirty) {
      await mkdir(this.configDir, { recursive: true });
      await this.writeJsonAtomic(file, settings);
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
        const skillMd = path.join(this.skillsDir, entry.name, 'SKILL.md');
        if (!existsSync(skillMd)) {
          continue; // a directory without a SKILL.md is not a skill
        }
        relPath = path.join(entry.name, 'SKILL.md');
        format = 'dir';
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
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
    const basename = format === 'dir' ? path.dirname(relPath) : relPath.slice(0, -'.md'.length);
    // Canonical identity is the frontmatter `name` when it is a valid slug (Agent Skills spec:
    // the folder is a storage detail, the declared name is the skill's identity). Fall back to the
    // on-disk basename so hand-written flat files without a `name` still load.
    const declared = typeof frontmatter.name === 'string' ? frontmatter.name : undefined;
    const name = declared && skillNameSchema.safeParse(declared).success ? declared : basename;
    if (!skillNameSchema.safeParse(name).success) {
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
      path: relPath,
      updatedAt: stats.mtime.toISOString(),
      files,
      tags: normalizeTags(frontmatter.tags),
    });
  }

  /** Every entry under a skill's folder (relative to skillsDir) except its SKILL.md — files and sub-dirs, paths relative to that folder. */
  private async listSupportingFiles(folderRel: string): Promise<SkillFile[]> {
    const dir = path.join(this.skillsDir, folderRel);
    const out: SkillFile[] = [];
    const walk = async (current: string): Promise<void> => {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        const rel = toPosix(path.relative(dir, full));
        if (entry.isDirectory()) {
          out.push({ path: rel, type: 'dir', size: 0 });
          await walk(full);
        } else if (entry.isFile()) {
          if (rel === 'SKILL.md') {
            continue;
          }
          const stats = await stat(full);
          out.push({ path: rel, type: 'file', size: stats.size });
        }
      }
    };
    await walk(dir);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async loadProfiles(): Promise<Map<string, ProfileConfig>> {
    const profiles = new Map<string, ProfileConfig>();
    if (!existsSync(this.profilesDir)) {
      return profiles;
    }
    const files = (await readdir(this.profilesDir)).filter((f) => f.endsWith('.json'));
    for (const file of files.sort()) {
      const fullPath = path.join(this.profilesDir, file);
      try {
        const config = this.parseJson(
          fullPath,
          await readFile(fullPath, 'utf8'),
          profileConfigSchema.parse.bind(profileConfigSchema),
        );
        if (`${config.slug}.json` !== file) {
          console.warn(`Profile config ${fullPath} has slug "${config.slug}" that does not match its filename`);
        }
        profiles.set(config.slug, config);
      } catch (err) {
        console.error(`Ignoring invalid profile config ${fullPath}: ${errorMessage(err)}`);
      }
    }
    return profiles;
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

  /** Atomic write of a JSON value: tmp file in the same dir, chmod 0600, rename over the target. */
  private async writeJsonAtomic(file: string, value: unknown): Promise<void> {
    await this.writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`, 0o600);
  }

  /** Atomic write of text: tmp file in the same dir, rename over the target. */
  private async writeTextAtomic(file: string, content: string, mode = 0o644): Promise<void> {
    await this.writeBufferAtomic(file, Buffer.from(content, 'utf8'), mode);
  }

  /** Atomic write of raw bytes: tmp file in the same dir, chmod, rename over the target. */
  private async writeBufferAtomic(file: string, content: Buffer, mode = 0o644): Promise<void> {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, content, { mode });
    await chmod(tmp, mode);
    await rename(tmp, file);
  }
}
