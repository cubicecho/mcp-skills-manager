import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
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
    expect(Object.keys(view).sort()).toEqual(['authEnabled', 'authoringEnabled', 'skillToolMode']);
  });
});
