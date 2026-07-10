import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from './store.ts';

const skillMd = (name: string, description: string) =>
  Buffer.from(`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);

/** File paths only (directories are listed too, but most assertions care about the files). */
const filePaths = (skill: { files: { path: string; type: 'file' | 'dir' }[] }) =>
  skill.files.filter((f) => f.type === 'file').map((f) => f.path);
const dirPaths = (skill: { files: { path: string; type: 'file' | 'dir' }[] }) =>
  skill.files.filter((f) => f.type === 'dir').map((f) => f.path);

describe('ConfigStore supporting files & import', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-test-'));
    store = new ConfigStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('imports a directory skill with supporting files and lists their parent folders', async () => {
    const skill = await store.importSkill({
      name: 'imported',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('imported', 'An imported skill') },
        { path: 'reference/notes.md', content: Buffer.from('notes') },
        { path: 'scripts/run.py', content: Buffer.from('print(1)') },
      ],
    });
    expect(skill.format).toBe('dir');
    expect(skill.description).toBe('An imported skill');
    expect(filePaths(skill)).toEqual(['reference/notes.md', 'scripts/run.py']);
    expect(dirPaths(skill)).toEqual(['reference', 'scripts']);
    expect(existsSync(path.join(dir, 'skills/imported/scripts/run.py'))).toBe(true);
  });

  it('imports a single-file skill written verbatim as <name>.md', async () => {
    const skill = await store.importSkill({
      name: 'flat',
      format: 'file',
      files: [{ path: 'ignored.md', content: skillMd('flat', 'A flat skill') }],
    });
    expect(skill.format).toBe('file');
    expect(skill.path).toBe('flat.md');
    expect(skill.files).toEqual([]);
  });

  it('rejects a directory import that lacks a SKILL.md', async () => {
    await expect(
      store.importSkill({ name: 'nomd', format: 'dir', files: [{ path: 'reference.md', content: Buffer.from('x') }] }),
    ).rejects.toThrow(/SKILL\.md/);
  });

  it('promotes a file skill to a directory when a supporting file is added', async () => {
    await store.createSkill({ name: 'promote', description: 'd', body: '# Promote' });
    expect(existsSync(path.join(dir, 'skills/promote.md'))).toBe(true);

    const skill = await store.writeSupportingFile('promote', 'data/x.txt', Buffer.from('hello'));
    expect(skill.format).toBe('dir');
    expect(filePaths(skill)).toEqual(['data/x.txt']);
    expect(existsSync(path.join(dir, 'skills/promote.md'))).toBe(false);
    expect(existsSync(path.join(dir, 'skills/promote/SKILL.md'))).toBe(true);
    // The body survives the promotion.
    expect(skill.body).toContain('# Promote');
  });

  it('rejects path traversal in a supporting file path', async () => {
    await store.createSkill({ name: 'safe', description: 'd', body: '# Safe', format: 'dir' });
    await expect(store.writeSupportingFile('safe', '../escape.txt', Buffer.from('x'))).rejects.toThrow(/Unsafe/);
    await expect(store.writeSupportingFile('safe', 'nested/../../escape.txt', Buffer.from('x'))).rejects.toThrow(
      /Unsafe/,
    );
    expect(existsSync(path.join(dir, 'skills/escape.txt'))).toBe(false);
    expect(existsSync(path.join(dir, 'escape.txt'))).toBe(false);
  });

  it('refuses to write or delete SKILL.md as a supporting file', async () => {
    await store.createSkill({ name: 'guard', description: 'd', body: '# Guard', format: 'dir' });
    await expect(store.writeSupportingFile('guard', 'SKILL.md', Buffer.from('x'))).rejects.toThrow(/SKILL\.md/);
    await expect(store.deleteSupportingFile('guard', 'SKILL.md')).rejects.toThrow(/SKILL\.md/);
  });

  it('deletes a supporting file and prunes the directory it empties', async () => {
    await store.importSkill({
      name: 'prune',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('prune', 'd') },
        { path: 'nested/only.txt', content: Buffer.from('x') },
      ],
    });
    const skill = await store.deleteSupportingFile('prune', 'nested/only.txt');
    expect(skill.files).toEqual([]);
    expect(existsSync(path.join(dir, 'skills/prune/nested'))).toBe(false);
    expect(existsSync(path.join(dir, 'skills/prune/SKILL.md'))).toBe(true);
  });

  it('reads a text file as UTF-8 and a binary file as base64', async () => {
    await store.createSkill({ name: 'reader', description: 'd', body: '# Reader', format: 'dir' });
    await store.writeSupportingFile('reader', 'note.txt', Buffer.from('hello world'));
    await store.writeSupportingFile('reader', 'blob.bin', Buffer.from([0, 1, 2, 255, 254]));

    const text = await store.readSupportingFile('reader', 'note.txt');
    expect(text).toMatchObject({ binary: false, encoding: 'utf8', content: 'hello world' });

    const binary = await store.readSupportingFile('reader', 'blob.bin');
    expect(binary.binary).toBe(true);
    expect(binary.encoding).toBe('base64');
    expect(Buffer.from(binary.content, 'base64')).toEqual(Buffer.from([0, 1, 2, 255, 254]));
  });

  it('creates an empty folder that appears in the listing (and promotes a file skill)', async () => {
    await store.createSkill({ name: 'folders', description: 'd', body: '# Folders' });
    const skill = await store.createSupportingFolder('folders', 'reference/examples');
    expect(skill.format).toBe('dir');
    expect(dirPaths(skill)).toEqual(['reference', 'reference/examples']);
    expect(existsSync(path.join(dir, 'skills/folders/reference/examples'))).toBe(true);
    await expect(store.createSupportingFolder('folders', 'reference/examples')).rejects.toThrow(/already exists/);
  });

  it('renames a file, pruning the folder it leaves empty', async () => {
    await store.importSkill({
      name: 'mv',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('mv', 'd') },
        { path: 'a/x.txt', content: Buffer.from('x') },
      ],
    });
    const skill = await store.moveSupportingPath('mv', 'a/x.txt', 'b/y.txt');
    expect(filePaths(skill)).toEqual(['b/y.txt']);
    expect(existsSync(path.join(dir, 'skills/mv/a'))).toBe(false);
    expect(existsSync(path.join(dir, 'skills/mv/b/y.txt'))).toBe(true);
  });

  it('renames a folder and everything under it', async () => {
    await store.importSkill({
      name: 'mvdir',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('mvdir', 'd') },
        { path: 'reference/notes.md', content: Buffer.from('n') },
        { path: 'reference/deep/data.txt', content: Buffer.from('d') },
      ],
    });
    const skill = await store.moveSupportingPath('mvdir', 'reference', 'docs');
    expect(filePaths(skill)).toEqual(['docs/deep/data.txt', 'docs/notes.md']);
    expect(existsSync(path.join(dir, 'skills/mvdir/reference'))).toBe(false);
  });

  it('rejects moving a folder into itself and overwriting an existing path', async () => {
    await store.importSkill({
      name: 'mvbad',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('mvbad', 'd') },
        { path: 'a/x.txt', content: Buffer.from('x') },
        { path: 'b/y.txt', content: Buffer.from('y') },
      ],
    });
    await expect(store.moveSupportingPath('mvbad', 'a', 'a/child')).rejects.toThrow(/into itself/);
    await expect(store.moveSupportingPath('mvbad', 'a/x.txt', 'b/y.txt')).rejects.toThrow(/already exists/);
  });

  it('deletes a folder recursively', async () => {
    await store.importSkill({
      name: 'rmdir',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('rmdir', 'd') },
        { path: 'keep.txt', content: Buffer.from('k') },
        { path: 'scripts/a.py', content: Buffer.from('a') },
        { path: 'scripts/lib/b.py', content: Buffer.from('b') },
      ],
    });
    const skill = await store.deleteSupportingFile('rmdir', 'scripts');
    expect(filePaths(skill)).toEqual(['keep.txt']);
    expect(existsSync(path.join(dir, 'skills/rmdir/scripts'))).toBe(false);
  });

  it('exports a directory skill as a zip nested under <name>/', async () => {
    await store.importSkill({
      name: 'zippy',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('zippy', 'd') },
        { path: 'reference/notes.md', content: Buffer.from('notes') },
      ],
    });
    const zip = await store.exportSkillZip('zippy');
    const entries = unzipSync(new Uint8Array(zip));
    expect(Object.keys(entries).sort()).toEqual(['zippy/SKILL.md', 'zippy/reference/notes.md']);
    expect(Buffer.from(entries['zippy/reference/notes.md'] as Uint8Array).toString('utf8')).toBe('notes');
  });

  it('exports a file skill as a lone <name>.md', async () => {
    await store.createSkill({ name: 'onefile', description: 'd', body: '# One' });
    const zip = await store.exportSkillZip('onefile');
    const entries = unzipSync(new Uint8Array(zip));
    expect(Object.keys(entries)).toEqual(['onefile.md']);
    expect(Buffer.from(entries['onefile.md'] as Uint8Array).toString('utf8')).toContain('# One');
  });
});

describe('ConfigStore on-disk skill identity', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-name-'));
    store = new ConfigStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  /** Write a dir-convention skill (folder + SKILL.md + optional supporting files) straight to disk. */
  const dropDirSkill = async (
    folder: string,
    frontmatter: string,
    files: Record<string, string> = {},
  ): Promise<void> => {
    const root = path.join(dir, 'skills', folder);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# ${folder}\n`);
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(path.join(root, path.dirname(rel)), { recursive: true });
      await writeFile(path.join(root, rel), content);
    }
  };

  it('loads a skill under its frontmatter name even when the folder is not a slug', async () => {
    // A real Agent-Skills folder copied in with an uppercased directory name — previously dropped
    // silently because the folder basename failed the slug check.
    await dropDirSkill('PDF-Forms', 'name: pdf-forms\ndescription: fill pdfs', { 'scripts/fill.py': 'print(1)' });
    await store.reload();

    const skill = store.getSkill('pdf-forms');
    expect(skill).toBeDefined();
    expect(skill?.path).toBe('PDF-Forms/SKILL.md');
    expect(filePaths(skill ?? { files: [] })).toEqual(['scripts/fill.py']);
    // Bundled files resolve through the real on-disk folder, not the identity name.
    const read = await store.readSupportingFile('pdf-forms', 'scripts/fill.py');
    expect(read.content).toBe('print(1)');
  });

  it('prefers the frontmatter name over a differing folder name', async () => {
    await dropDirSkill('haxe-lang', 'name: haxe\ndescription: haxe');
    await store.reload();
    expect(store.getSkill('haxe')).toBeDefined();
    expect(store.getSkill('haxe-lang')).toBeUndefined();
  });

  it('falls back to the folder name when no frontmatter name is given', async () => {
    await dropDirSkill('plain', 'description: no name key');
    await store.reload();
    expect(store.getSkill('plain')).toBeDefined();
  });

  it('skips a skill when neither the folder nor the frontmatter yields a valid slug', async () => {
    await dropDirSkill('Bad Folder', 'description: still no valid name');
    await store.reload();
    // Not seen, but the load did not crash and other skills are unaffected.
    expect(store.getSkills().some((s) => s.name.includes(' '))).toBe(false);
  });

  it('keeps the first of two skills that resolve to the same name', async () => {
    // Sorted folder order: "aaa" before "zzz"; both declare name "dupe".
    await dropDirSkill('aaa', 'name: dupe\ndescription: first');
    await dropDirSkill('zzz', 'name: dupe\ndescription: second');
    await store.reload();
    const dupe = store.getSkill('dupe');
    expect(dupe?.path).toBe('aaa/SKILL.md');
    expect(dupe?.description).toBe('first');
  });

  it('edits a mismatched-folder skill against its real folder, preserving identity', async () => {
    await dropDirSkill('My-Skill', 'name: my-skill\ndescription: d');
    await store.reload();
    const skill = await store.writeSupportingFile('my-skill', 'notes.txt', Buffer.from('hi'));
    expect(skill.name).toBe('my-skill');
    expect(filePaths(skill)).toEqual(['notes.txt']);
    // Written into the real folder, never a new folder named after the identity.
    expect(existsSync(path.join(dir, 'skills/My-Skill/notes.txt'))).toBe(true);
    expect(existsSync(path.join(dir, 'skills/my-skill'))).toBe(false);
  });
});

describe('ConfigStore skillToolMode resolution', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-mode-'));
    store = new ConfigStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('defaults to per-skill and reflects a global override', async () => {
    expect(store.getSkillToolMode()).toBe('per-skill');
    await store.updateSettings({ skillToolMode: 'loader' });
    expect(store.getSkillToolMode()).toBe('loader');
    expect(store.getSettingsView().skillToolMode).toBe('loader');
  });

  it('inherits the global mode for a profile with no override, and overrides when set', async () => {
    await store.updateSettings({ skillToolMode: 'loader' });
    const inheriting = await store.saveProfile({ name: 'A', slug: 'a', enabled: true, skills: [] });
    expect(store.getSkillToolModeForProfile(inheriting)).toBe('loader'); // inherits global

    const pinned = await store.saveProfile({
      name: 'B',
      slug: 'b',
      enabled: true,
      skills: [],
      skillToolMode: 'per-skill',
    });
    expect(store.getSkillToolModeForProfile(pinned)).toBe('per-skill'); // override wins over global
  });

  it('omits the auth token from the settings view', async () => {
    const view = store.getSettingsView();
    expect(view).not.toHaveProperty('authToken');
    expect(Object.keys(view).sort()).toEqual(['authEnabled', 'authoringEnabled', 'httpLiveUpdates', 'skillToolMode']);
  });
});

describe('ConfigStore profile membership integrity', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-membership-'));
    store = new ConfigStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('drops a deleted skill from every profile that referenced it', async () => {
    await store.createSkill({ name: 'keep', description: 'k', body: '# keep' });
    await store.createSkill({ name: 'gone', description: 'g', body: '# gone' });
    await store.saveProfile({ name: 'A', slug: 'a', enabled: true, skills: ['keep', 'gone'] });
    await store.saveProfile({ name: 'B', slug: 'b', enabled: true, skills: ['gone'] });

    await store.deleteSkill('gone');

    expect(store.getProfile('a')?.skills).toEqual(['keep']);
    expect(store.getProfile('b')?.skills).toEqual([]);
  });

  it('retargets profile references to the new name when a skill is renamed', async () => {
    await store.createSkill({ name: 'before', description: 'b', body: '# before' });
    await store.createSkill({ name: 'other', description: 'o', body: '# other' });
    await store.saveProfile({ name: 'A', slug: 'a', enabled: true, skills: ['other', 'before'] });

    await store.renameSkill('before', 'after');

    expect(store.getProfile('a')?.skills).toEqual(['other', 'after']);
  });

  it('silently prunes members that no longer exist when a profile is saved', async () => {
    await store.createSkill({ name: 'real', description: 'r', body: '# real' });
    const saved = await store.saveProfile({
      name: 'A',
      slug: 'a',
      enabled: true,
      skills: ['real', 'ghost'],
    });
    expect(saved.skills).toEqual(['real']);
    expect(store.getProfile('a')?.skills).toEqual(['real']);
  });
});

describe('ConfigStore skill tags', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-tags-'));
    store = new ConfigStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('persists normalized tags on create and round-trips them from disk', async () => {
    const created = await store.createSkill({
      name: 'tagged',
      description: 'd',
      body: '# tagged',
      tags: [' Backend ', 'backend', 'testing', ''],
    });
    // Trimmed, empties dropped, de-duplicated case-insensitively (first casing wins).
    expect(created.tags).toEqual(['Backend', 'testing']);
    expect(store.getSkill('tagged')?.tags).toEqual(['Backend', 'testing']);

    // A fresh store reading the same file sees the same tags.
    const reopened = new ConfigStore(dir);
    await reopened.init();
    expect(reopened.getSkill('tagged')?.tags).toEqual(['Backend', 'testing']);
    await reopened.close();
  });

  it('replaces tags on update and clears them with an empty list', async () => {
    await store.createSkill({ name: 'edit', description: 'd', body: '# edit', tags: ['one', 'two'] });

    const replaced = await store.updateSkill('edit', { tags: ['three'] });
    expect(replaced.tags).toEqual(['three']);

    const cleared = await store.updateSkill('edit', { tags: [] });
    expect(cleared.tags).toEqual([]);
    expect(cleared.frontmatter.tags).toBeUndefined();
  });

  it('leaves tags unchanged when the patch omits them', async () => {
    await store.createSkill({ name: 'keep', description: 'd', body: '# keep', tags: ['stable'] });
    const updated = await store.updateSkill('keep', { description: 'new desc' });
    expect(updated.tags).toEqual(['stable']);
  });

  it('parses comma-separated frontmatter tags written by hand', async () => {
    await mkdir(path.join(dir, 'skills'), { recursive: true });
    await writeFile(
      path.join(dir, 'skills', 'hand.md'),
      '---\nname: hand\ndescription: d\ntags: alpha, beta ,alpha\n---\n\n# hand\n',
    );
    await store.reload();
    expect(store.getSkill('hand')?.tags).toEqual(['alpha', 'beta']);
  });
});

describe('ConfigStore usage analytics', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-usage-'));
    store = new ConfigStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('reports zeros for a never-loaded skill', async () => {
    await store.createSkill({ name: 'fresh', description: 'd', body: '# fresh' });
    expect(store.getUsage('fresh')).toEqual({ count: 0, lastUsedAt: null });
  });

  it('counts loads and stamps lastUsedAt, persisting across a reopen', async () => {
    await store.createSkill({ name: 'used', description: 'd', body: '# used' });
    store.recordSkillUse('used');
    store.recordSkillUse('used');

    const stats = store.getUsage('used');
    expect(stats.count).toBe(2);
    expect(stats.lastUsedAt).not.toBeNull();

    // close() flushes the pending usage.json write; a fresh store reads it back.
    await store.close();
    const reopened = new ConfigStore(dir);
    await reopened.init();
    expect(reopened.getUsage('used')).toEqual(stats);
    await reopened.close();
  });

  it('carries usage over on rename and drops it on delete', async () => {
    await store.createSkill({ name: 'before', description: 'd', body: '# before' });
    store.recordSkillUse('before');

    await store.renameSkill('before', 'after');
    expect(store.getUsage('before')).toEqual({ count: 0, lastUsedAt: null });
    expect(store.getUsage('after').count).toBe(1);

    await store.deleteSkill('after');
    expect(store.getUsage('after')).toEqual({ count: 0, lastUsedAt: null });
  });

  it('keeps usage.json out of the watched dirs (never under config/ or skills/)', () => {
    expect(store.usageFile).toBe(path.join(dir, 'usage.json'));
    expect(store.usageFile.startsWith(store.configDir)).toBe(false);
    expect(store.usageFile.startsWith(store.skillsDir)).toBe(false);
  });
});
