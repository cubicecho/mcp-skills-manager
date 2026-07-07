import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProfileConfig, SettingsFile, Skill, SkillFile } from '@mcp-skills/shared';
import { profileConfigSchema, settingsFileSchema, skillNameSchema, skillSchema } from '@mcp-skills/shared';
import { type FSWatcher, watch } from 'chokidar';
import { authDisabledByEnv } from '../auth.ts';
import { errorMessage, HttpError } from '../errors.ts';
import { parseMarkdown, serializeMarkdown } from '../skills/markdown.ts';

export interface ConfigState {
  settings: SettingsFile;
  skills: Skill[];
  profiles: ProfileConfig[];
}

const WATCH_DEBOUNCE_MS = 300;

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

  constructor(dataDir: string) {
    super();
    this.dataDir = dataDir;
    this.configDir = path.join(dataDir, 'config');
    this.profilesDir = path.join(this.configDir, 'profiles');
    this.skillsDir = path.join(dataDir, 'skills');
  }

  /** Create directories, seed defaults on first run and load everything. */
  async init(): Promise<void> {
    await mkdir(this.profilesDir, { recursive: true });
    await mkdir(this.skillsDir, { recursive: true });
    await this.loadAll();
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

  /**
   * Create a new skill. `file` format writes skills/<name>.md; `dir` format
   * writes skills/<name>/SKILL.md. Rejects if the name is already taken.
   */
  async createSkill(input: {
    name: string;
    description: string;
    body: string;
    format?: Skill['format'];
  }): Promise<Skill> {
    const name = skillNameSchema.parse(input.name);
    if (this.skills.has(name)) {
      throw new HttpError(409, `Skill "${name}" already exists`);
    }
    const format = input.format ?? 'file';
    const relPath = format === 'dir' ? path.join(name, 'SKILL.md') : `${name}.md`;
    const fullPath = path.join(this.skillsDir, relPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    const content = serializeMarkdown({ name, description: input.description }, input.body);
    await this.writeTextAtomic(fullPath, content);
    return this.reloadSkill(name, relPath, format);
  }

  /** Update an existing skill's description and/or body in place, preserving unknown frontmatter and format. */
  async updateSkill(name: string, patch: { description?: string; body?: string }): Promise<Skill> {
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    const frontmatter = {
      ...existing.frontmatter,
      name,
      description: patch.description ?? existing.description,
    };
    const body = patch.body ?? existing.body;
    const fullPath = path.join(this.skillsDir, existing.path);
    await this.writeTextAtomic(fullPath, serializeMarkdown(frontmatter, body));
    return this.reloadSkill(name, existing.path, existing.format);
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
      const from = path.join(this.skillsDir, name);
      const to = path.join(this.skillsDir, target);
      await rename(from, to);
      const relPath = path.join(target, 'SKILL.md');
      // The SKILL.md frontmatter still carries the old name — rewrite it.
      await this.writeTextAtomic(
        path.join(this.skillsDir, relPath),
        serializeMarkdown({ ...existing.frontmatter, name: target, description: existing.description }, existing.body),
      );
      this.skills.delete(name);
      return this.reloadSkill(target, relPath, 'dir');
    }
    const relPath = `${target}.md`;
    await this.writeTextAtomic(
      path.join(this.skillsDir, relPath),
      serializeMarkdown({ ...existing.frontmatter, name: target, description: existing.description }, existing.body),
    );
    await rm(path.join(this.skillsDir, existing.path), { force: true });
    this.skills.delete(name);
    return this.reloadSkill(target, relPath, 'file');
  }

  async deleteSkill(name: string): Promise<void> {
    const existing = this.skills.get(name);
    if (!existing) {
      throw new HttpError(404, `Unknown skill "${name}"`);
    }
    this.skills.delete(name);
    if (existing.format === 'dir') {
      await rm(path.join(this.skillsDir, name), { recursive: true, force: true });
    } else {
      await rm(path.join(this.skillsDir, existing.path), { force: true });
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
    this.profiles.set(parsed.slug, parsed);
    await this.writeJsonAtomic(this.profileFile(parsed.slug), parsed);
    return parsed;
  }

  async deleteProfile(slug: string): Promise<void> {
    this.profiles.delete(slug);
    await rm(this.profileFile(slug), { force: true });
  }

  // --- internals ---

  private profileFile(slug: string): string {
    return path.join(this.profilesDir, `${slug}.json`);
  }

  private async reloadSkill(name: string, relPath: string, format: Skill['format']): Promise<Skill> {
    const skill = await this.readSkill(name, relPath, format);
    this.skills.set(name, skill);
    return skill;
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
      let name: string;
      let relPath: string;
      let format: Skill['format'];
      if (entry.isDirectory()) {
        const skillMd = path.join(this.skillsDir, entry.name, 'SKILL.md');
        if (!existsSync(skillMd)) {
          continue; // a directory without a SKILL.md is not a skill
        }
        name = entry.name;
        relPath = path.join(entry.name, 'SKILL.md');
        format = 'dir';
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        name = entry.name.slice(0, -'.md'.length);
        relPath = entry.name;
        format = 'file';
      } else {
        continue;
      }
      if (!skillNameSchema.safeParse(name).success) {
        console.warn(`Ignoring skill "${name}": name is not a valid slug`);
        continue;
      }
      try {
        skills.set(name, await this.readSkill(name, relPath, format));
      } catch (err) {
        // A single broken (hand-edited) skill must not take the server down; report and skip it.
        console.error(`Ignoring invalid skill "${name}": ${errorMessage(err)}`);
      }
    }
    return skills;
  }

  private async readSkill(name: string, relPath: string, format: Skill['format']): Promise<Skill> {
    const fullPath = path.join(this.skillsDir, relPath);
    const raw = await readFile(fullPath, 'utf8');
    const { frontmatter, body } = parseMarkdown(raw);
    const stats = await stat(fullPath);
    const files = format === 'dir' ? await this.listSupportingFiles(name) : [];
    return skillSchema.parse({
      name,
      description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
      body,
      frontmatter,
      format,
      path: relPath,
      updatedAt: stats.mtime.toISOString(),
      files,
    });
  }

  /** Every file under skills/<name> except the SKILL.md itself, relative to that directory. */
  private async listSupportingFiles(name: string): Promise<SkillFile[]> {
    const dir = path.join(this.skillsDir, name);
    const out: SkillFile[] = [];
    const walk = async (current: string): Promise<void> => {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const rel = path.relative(dir, full);
          if (rel === 'SKILL.md') {
            continue;
          }
          const stats = await stat(full);
          out.push({ path: rel, size: stats.size });
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
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, content, { mode });
    await chmod(tmp, mode);
    await rename(tmp, file);
  }
}
