import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillSourceFetcher } from '../sources/git-fetch.ts';
import { useTempStore } from '../test/temp-store.ts';
import { ConfigStore } from './store.ts';

const skillMd = (name: string, description: string) =>
  Buffer.from(`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);

/** Wait long enough for the file watcher to start, or to debounce and report a change it saw. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

/** File paths only (directories are listed too, but most assertions care about the files). */
const filePaths = (skill: { files: { path: string; type: 'file' | 'dir' }[] }) =>
  skill.files.filter((f) => f.type === 'file').map((f) => f.path);
const dirPaths = (skill: { files: { path: string; type: 'file' | 'dir' }[] }) =>
  skill.files.filter((f) => f.type === 'dir').map((f) => f.path);

describe('ConfigStore supporting files & import', () => {
  const temp = useTempStore();

  it('imports a directory skill with supporting files and lists their parent folders', async () => {
    const skill = await temp.store.importSkill({
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
    expect(existsSync(path.join(temp.dir, 'skills/imported/scripts/run.py'))).toBe(true);
  });

  it('imports a single-file skill written verbatim as <name>.md', async () => {
    const skill = await temp.store.importSkill({
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
      temp.store.importSkill({
        name: 'nomd',
        format: 'dir',
        files: [{ path: 'reference.md', content: Buffer.from('x') }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('promotes a file skill to a directory when a supporting file is added', async () => {
    await temp.store.createSkill({ name: 'promote', description: 'd', body: '# Promote' });
    expect(existsSync(path.join(temp.dir, 'skills/promote.md'))).toBe(true);

    const skill = await temp.store.writeSupportingFile('promote', 'data/x.txt', Buffer.from('hello'));
    expect(skill.format).toBe('dir');
    expect(filePaths(skill)).toEqual(['data/x.txt']);
    expect(existsSync(path.join(temp.dir, 'skills/promote.md'))).toBe(false);
    expect(existsSync(path.join(temp.dir, 'skills/promote/SKILL.md'))).toBe(true);
    // The body survives the promotion.
    expect(skill.body).toContain('# Promote');
  });

  it('rejects path traversal in a supporting file path', async () => {
    await temp.store.createSkill({ name: 'safe', description: 'd', body: '# Safe', format: 'dir' });
    await expect(temp.store.writeSupportingFile('safe', '../escape.txt', Buffer.from('x'))).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      temp.store.writeSupportingFile('safe', 'nested/../../escape.txt', Buffer.from('x')),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(existsSync(path.join(temp.dir, 'skills/escape.txt'))).toBe(false);
    expect(existsSync(path.join(temp.dir, 'escape.txt'))).toBe(false);
  });

  it('refuses to write or delete SKILL.md as a supporting file', async () => {
    await temp.store.createSkill({ name: 'guard', description: 'd', body: '# Guard', format: 'dir' });
    await expect(temp.store.writeSupportingFile('guard', 'SKILL.md', Buffer.from('x'))).rejects.toMatchObject({
      status: 400,
    });
    await expect(temp.store.deleteSupportingFile('guard', 'SKILL.md')).rejects.toMatchObject({ status: 400 });
  });

  it('says the same thing wherever SKILL.md is named as a supporting file', async () => {
    await temp.store.createSkill({ name: 'guard', description: 'd', body: '# Guard', format: 'dir' });
    await temp.store.writeSupportingFile('guard', 'notes.md', Buffer.from('x'));
    const reserved = {
      status: 400,
      message: "SKILL.md is the skill's own document, not a supporting file",
      detail: 'change it by editing the skill body (update_skill or edit_skill over MCP)',
    };
    await expect(temp.store.writeSupportingFile('guard', 'SKILL.md', Buffer.from('x'))).rejects.toMatchObject(reserved);
    await expect(temp.store.createSupportingFolder('guard', 'SKILL.md')).rejects.toMatchObject(reserved);
    await expect(temp.store.moveSupportingPath('guard', 'notes.md', 'SKILL.md')).rejects.toMatchObject(reserved);
  });

  it('tells a reader that a single-file skill has no supporting files, and how it gets them', async () => {
    await temp.store.createSkill({ name: 'flat', description: 'd', body: '# Flat', format: 'file' });
    await expect(temp.store.readSupportingFile('flat', 'notes.md')).rejects.toMatchObject({
      status: 400,
      message: 'Skill "flat" is a single file, so it has no supporting files',
      detail: 'writing a supporting file to it turns it into a folder skill',
    });
  });

  it('deletes a supporting file and prunes the directory it empties', async () => {
    await temp.store.importSkill({
      name: 'prune',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('prune', 'd') },
        { path: 'nested/only.txt', content: Buffer.from('x') },
      ],
    });
    const skill = await temp.store.deleteSupportingFile('prune', 'nested/only.txt');
    expect(skill.files).toEqual([]);
    expect(existsSync(path.join(temp.dir, 'skills/prune/nested'))).toBe(false);
    expect(existsSync(path.join(temp.dir, 'skills/prune/SKILL.md'))).toBe(true);
  });

  it('reads a text file as UTF-8 and a binary file as base64', async () => {
    await temp.store.createSkill({ name: 'reader', description: 'd', body: '# Reader', format: 'dir' });
    await temp.store.writeSupportingFile('reader', 'note.txt', Buffer.from('hello world'));
    await temp.store.writeSupportingFile('reader', 'blob.bin', Buffer.from([0, 1, 2, 255, 254]));

    const text = await temp.store.readSupportingFile('reader', 'note.txt');
    expect(text).toMatchObject({ binary: false, encoding: 'utf8', content: 'hello world' });

    const binary = await temp.store.readSupportingFile('reader', 'blob.bin');
    expect(binary.binary).toBe(true);
    expect(binary.encoding).toBe('base64');
    expect(Buffer.from(binary.content, 'base64')).toEqual(Buffer.from([0, 1, 2, 255, 254]));
  });

  it('creates an empty folder that appears in the listing (and promotes a file skill)', async () => {
    await temp.store.createSkill({ name: 'folders', description: 'd', body: '# Folders' });
    const skill = await temp.store.createSupportingFolder('folders', 'reference/examples');
    expect(skill.format).toBe('dir');
    expect(dirPaths(skill)).toEqual(['reference', 'reference/examples']);
    expect(existsSync(path.join(temp.dir, 'skills/folders/reference/examples'))).toBe(true);
    await expect(temp.store.createSupportingFolder('folders', 'reference/examples')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('renames a file, pruning the folder it leaves empty', async () => {
    await temp.store.importSkill({
      name: 'mv',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('mv', 'd') },
        { path: 'a/x.txt', content: Buffer.from('x') },
      ],
    });
    const skill = await temp.store.moveSupportingPath('mv', 'a/x.txt', 'b/y.txt');
    expect(filePaths(skill)).toEqual(['b/y.txt']);
    expect(existsSync(path.join(temp.dir, 'skills/mv/a'))).toBe(false);
    expect(existsSync(path.join(temp.dir, 'skills/mv/b/y.txt'))).toBe(true);
  });

  it('renames a folder and everything under it', async () => {
    await temp.store.importSkill({
      name: 'mvdir',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('mvdir', 'd') },
        { path: 'reference/notes.md', content: Buffer.from('n') },
        { path: 'reference/deep/data.txt', content: Buffer.from('d') },
      ],
    });
    const skill = await temp.store.moveSupportingPath('mvdir', 'reference', 'docs');
    expect(filePaths(skill)).toEqual(['docs/deep/data.txt', 'docs/notes.md']);
    expect(existsSync(path.join(temp.dir, 'skills/mvdir/reference'))).toBe(false);
  });

  it('rejects moving a folder into itself and overwriting an existing path', async () => {
    await temp.store.importSkill({
      name: 'mvbad',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('mvbad', 'd') },
        { path: 'a/x.txt', content: Buffer.from('x') },
        { path: 'b/y.txt', content: Buffer.from('y') },
      ],
    });
    await expect(temp.store.moveSupportingPath('mvbad', 'a', 'a/child')).rejects.toMatchObject({ status: 400 });
    await expect(temp.store.moveSupportingPath('mvbad', 'a/x.txt', 'b/y.txt')).rejects.toMatchObject({ status: 409 });
  });

  it('deletes a folder recursively', async () => {
    await temp.store.importSkill({
      name: 'rmdir',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('rmdir', 'd') },
        { path: 'keep.txt', content: Buffer.from('k') },
        { path: 'scripts/a.py', content: Buffer.from('a') },
        { path: 'scripts/lib/b.py', content: Buffer.from('b') },
      ],
    });
    const skill = await temp.store.deleteSupportingFile('rmdir', 'scripts');
    expect(filePaths(skill)).toEqual(['keep.txt']);
    expect(existsSync(path.join(temp.dir, 'skills/rmdir/scripts'))).toBe(false);
  });

  it('exports a directory skill as a zip nested under <name>/', async () => {
    await temp.store.importSkill({
      name: 'zippy',
      format: 'dir',
      files: [
        { path: 'SKILL.md', content: skillMd('zippy', 'd') },
        { path: 'reference/notes.md', content: Buffer.from('notes') },
      ],
    });
    const zip = await temp.store.exportSkillZip('zippy');
    const entries = unzipSync(new Uint8Array(zip));
    expect(Object.keys(entries).sort()).toEqual(['zippy/SKILL.md', 'zippy/reference/notes.md']);
    expect(Buffer.from(entries['zippy/reference/notes.md'] as Uint8Array).toString('utf8')).toBe('notes');
  });

  it('exports a file skill as a lone <name>.md', async () => {
    await temp.store.createSkill({ name: 'onefile', description: 'd', body: '# One' });
    const zip = await temp.store.exportSkillZip('onefile');
    const entries = unzipSync(new Uint8Array(zip));
    expect(Object.keys(entries)).toEqual(['onefile.md']);
    expect(Buffer.from(entries['onefile.md'] as Uint8Array).toString('utf8')).toContain('# One');
  });
});

describe('ConfigStore on-disk skill identity', () => {
  const temp = useTempStore();

  /** Write a dir-convention skill (folder + SKILL.md + optional supporting files) straight to disk. */
  const dropDirSkill = async (
    folder: string,
    frontmatter: string,
    files: Record<string, string> = {},
  ): Promise<void> => {
    const root = path.join(temp.dir, 'skills', folder);
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
    await temp.store.reload();

    const skill = temp.store.getSkill('pdf-forms');
    expect(skill).toBeDefined();
    expect(skill?.path).toBe('PDF-Forms/SKILL.md');
    expect(filePaths(skill ?? { files: [] })).toEqual(['scripts/fill.py']);
    // Bundled files resolve through the real on-disk folder, not the identity name.
    const read = await temp.store.readSupportingFile('pdf-forms', 'scripts/fill.py');
    expect(read.content).toBe('print(1)');
  });

  it('prefers the frontmatter name over a differing folder name', async () => {
    await dropDirSkill('haxe-lang', 'name: haxe\ndescription: haxe');
    await temp.store.reload();
    expect(temp.store.getSkill('haxe')).toBeDefined();
    expect(temp.store.getSkill('haxe-lang')).toBeUndefined();
  });

  it('falls back to the folder name when no frontmatter name is given', async () => {
    await dropDirSkill('plain', 'description: no name key');
    await temp.store.reload();
    expect(temp.store.getSkill('plain')).toBeDefined();
  });

  it('skips a skill when neither the folder nor the frontmatter yields a valid slug', async () => {
    await dropDirSkill('Bad Folder', 'description: still no valid name');
    await temp.store.reload();
    // Not seen, but the load did not crash and other skills are unaffected.
    expect(temp.store.getSkills().some((s) => s.name.includes(' '))).toBe(false);
  });

  it('keeps the first of two skills that resolve to the same name', async () => {
    // Sorted folder order: "aaa" before "zzz"; both declare name "dupe".
    await dropDirSkill('aaa', 'name: dupe\ndescription: first');
    await dropDirSkill('zzz', 'name: dupe\ndescription: second');
    await temp.store.reload();
    const dupe = temp.store.getSkill('dupe');
    expect(dupe?.path).toBe('aaa/SKILL.md');
    expect(dupe?.description).toBe('first');
  });

  it('edits a mismatched-folder skill against its real folder, preserving identity', async () => {
    await dropDirSkill('My-Skill', 'name: my-skill\ndescription: d');
    await temp.store.reload();
    const skill = await temp.store.writeSupportingFile('my-skill', 'notes.txt', Buffer.from('hi'));
    expect(skill.name).toBe('my-skill');
    expect(filePaths(skill)).toEqual(['notes.txt']);
    // Written into the real folder, never a new folder named after the identity.
    expect(existsSync(path.join(temp.dir, 'skills/My-Skill/notes.txt'))).toBe(true);
    expect(existsSync(path.join(temp.dir, 'skills/my-skill'))).toBe(false);
  });

  it('refuses to create a skill, or rename one, onto a name another skill holds', async () => {
    await temp.store.createSkill({ name: 'taken', description: 'd', body: 'b' });
    await temp.store.createSkill({ name: 'other', description: 'd', body: 'b' });
    await expect(temp.store.createSkill({ name: 'taken', description: 'again', body: 'b' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(temp.store.renameSkill('other', 'taken')).rejects.toMatchObject({ status: 409 });
    expect(temp.store.getSkill('taken')?.description).toBe('d');
  });

  it("refuses a new skill whose name is another skill's folder, leaving that skill intact", async () => {
    await dropDirSkill('haxe-lang', 'name: haxe\ndescription: haxe');
    await temp.store.reload();
    for (const format of ['dir', 'file'] as const) {
      await expect(
        temp.store.createSkill({ name: 'haxe-lang', description: 'd', body: 'b', format }),
      ).rejects.toMatchObject({ status: 409 });
    }
    await expect(
      temp.store.importSkill({
        name: 'haxe-lang',
        format: 'dir',
        files: [{ path: 'SKILL.md', content: skillMd('x', 'd') }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await temp.store.reload();
    expect(temp.store.getSkill('haxe')?.description).toBe('haxe');
    expect(temp.store.getSkill('haxe-lang')).toBeUndefined();
  });

  it('refuses a rename onto a folder that is on disk but is no skill', async () => {
    await mkdir(path.join(temp.dir, 'skills/stray'), { recursive: true });
    await writeFile(path.join(temp.dir, 'skills/stray/notes.txt'), 'kept');
    await temp.store.createSkill({ name: 'mover', description: 'd', body: 'b', format: 'dir' });
    await expect(temp.store.renameSkill('mover', 'stray')).rejects.toMatchObject({ status: 409 });
    expect(temp.store.getSkill('mover')).toBeDefined();
  });

  it('renames a skill to the name of its own folder or file', async () => {
    await dropDirSkill('haxe-lang', 'name: haxe\ndescription: haxe');
    await writeFile(path.join(temp.dir, 'skills/stem.md'), '---\nname: declared\ndescription: flat\n---\n\nbody\n');
    await temp.store.reload();
    expect((await temp.store.renameSkill('haxe', 'haxe-lang')).path).toBe('haxe-lang/SKILL.md');
    expect((await temp.store.renameSkill('declared', 'stem')).path).toBe('stem.md');
    await temp.store.reload();
    expect(temp.store.getSkill('stem')?.description).toBe('flat');
  });

  it('refuses to promote a flat skill into a folder another skill holds', async () => {
    await dropDirSkill('shared', 'name: in-folder\ndescription: folder');
    await writeFile(path.join(temp.dir, 'skills/shared.md'), '---\nname: in-file\ndescription: flat\n---\n\nbody\n');
    await temp.store.reload();
    await expect(temp.store.writeSupportingFile('in-file', 'notes.md', Buffer.from('n'))).rejects.toMatchObject({
      status: 409,
    });
    await temp.store.reload();
    expect(temp.store.getSkill('in-folder')?.description).toBe('folder');
    expect(temp.store.getSkill('in-file')?.format).toBe('file');
  });

  it('registers an upload under the chosen name, not the name its frontmatter declares', async () => {
    await temp.store.createSkill({ name: 'taken', description: 'original', body: 'b', format: 'dir' });
    const asDir = await temp.store.importSkill({
      name: 'upload-dir',
      format: 'dir',
      files: [{ path: 'SKILL.md', content: skillMd('taken', 'uploaded dir') }],
    });
    const asFile = await temp.store.importSkill({
      name: 'upload-file',
      format: 'file',
      files: [{ path: 'x.md', content: skillMd('taken', 'uploaded file') }],
    });
    expect([asDir.name, asFile.name]).toEqual(['upload-dir', 'upload-file']);
    await temp.store.reload();
    expect(temp.store.getSkill('taken')?.description).toBe('original');
    expect(temp.store.getSkill('upload-dir')?.description).toBe('uploaded dir');
    expect(temp.store.getSkill('upload-file')?.description).toBe('uploaded file');
  });

  it('writes an upload verbatim when its declared name is the chosen one', async () => {
    const raw = '---\ndescription: d\nname:   same\n---\nbody';
    await temp.store.importSkill({
      name: 'same',
      format: 'file',
      files: [{ path: 'x.md', content: Buffer.from(raw) }],
    });
    expect(await readFile(path.join(temp.dir, 'skills/same.md'), 'utf8')).toBe(raw);
  });

  it('keeps a skill protected and scoped when another frontmatter value is mistyped', async () => {
    await dropDirSkill('guarded', 'name: guarded\ndescription: 123\nreadonly: true\nglobal: false\nauthor: ada');
    await temp.store.reload();
    expect(temp.store.getSkill('guarded')).toMatchObject({ readOnly: true, global: false });
    await temp.store.updateSkill('guarded', { body: 'edited' });
    const raw = await readFile(path.join(temp.dir, 'skills/guarded/SKILL.md'), 'utf8');
    expect(raw).toContain('readonly: true');
    expect(raw).toContain('author: ada');
  });

  it('renames a mismatched-folder skill, moving its folder to the new name', async () => {
    await dropDirSkill('My-Skill', 'name: my-skill\ndescription: d', { 'notes.txt': 'hi' });
    await temp.store.reload();
    const renamed = await temp.store.renameSkill('my-skill', 'renamed');
    expect(renamed.path).toBe('renamed/SKILL.md');
    expect(existsSync(path.join(temp.dir, 'skills/My-Skill'))).toBe(false);
    expect(existsSync(path.join(temp.dir, 'skills/renamed/notes.txt'))).toBe(true);
  });

  it('creates a workspace-scoped skill and deletes a dir skill with its folder', async () => {
    const scoped = await temp.store.createSkill({
      name: 'scoped',
      description: 'd',
      body: 'b',
      format: 'dir',
      global: false,
    });
    expect(scoped.global).toBe(false);
    await temp.store.deleteSkill('scoped');
    expect(temp.store.getSkill('scoped')).toBeUndefined();
    expect(existsSync(path.join(temp.dir, 'skills/scoped'))).toBe(false);
  });
});

describe('ConfigStore skillToolMode resolution', () => {
  const temp = useTempStore();

  it('defaults to per-skill and reflects a global override', async () => {
    expect(temp.store.getSkillToolMode()).toBe('per-skill');
    await temp.store.updateSettings({ skillToolMode: 'loader' });
    expect(temp.store.getSkillToolMode()).toBe('loader');
    expect(temp.store.getSettingsView().skillToolMode).toBe('loader');
  });

  it('inherits the global mode for a workspace with no override, and overrides when set', async () => {
    await temp.store.updateSettings({ skillToolMode: 'loader' });
    const inheriting = await temp.store.saveWorkspace({ name: 'A', slug: 'a', enabled: true, skills: [] });
    expect(temp.store.getSkillToolModeForWorkspace(inheriting)).toBe('loader'); // inherits global

    const pinned = await temp.store.saveWorkspace({
      name: 'B',
      slug: 'b',
      enabled: true,
      skills: [],
      skillToolMode: 'per-skill',
    });
    expect(temp.store.getSkillToolModeForWorkspace(pinned)).toBe('per-skill'); // override wins over global
  });

  it('omits the auth token from the settings view', async () => {
    const view = temp.store.getSettingsView();
    expect(view).not.toHaveProperty('authToken');
    expect(Object.keys(view).sort()).toEqual([
      'authEnabled',
      'authoringEnabled',
      'disabledAuthoringTools',
      'httpLiveUpdates',
      'skillToolMode',
    ]);
  });
});

describe('ConfigStore workspace membership integrity', () => {
  const temp = useTempStore();

  it('drops a deleted skill from every workspace that referenced it', async () => {
    await temp.store.createSkill({ name: 'keep', description: 'k', body: '# keep' });
    await temp.store.createSkill({ name: 'gone', description: 'g', body: '# gone' });
    await temp.store.saveWorkspace({ name: 'A', slug: 'a', enabled: true, skills: ['keep', 'gone'] });
    await temp.store.saveWorkspace({ name: 'B', slug: 'b', enabled: true, skills: ['gone'] });

    await temp.store.deleteSkill('gone');

    expect(temp.store.getWorkspace('a')?.skills).toEqual(['keep']);
    expect(temp.store.getWorkspace('b')?.skills).toEqual([]);
  });

  it('retargets workspace references to the new name when a skill is renamed', async () => {
    await temp.store.createSkill({ name: 'before', description: 'b', body: '# before' });
    await temp.store.createSkill({ name: 'other', description: 'o', body: '# other' });
    await temp.store.saveWorkspace({ name: 'A', slug: 'a', enabled: true, skills: ['other', 'before'] });

    await temp.store.renameSkill('before', 'after');

    expect(temp.store.getWorkspace('a')?.skills).toEqual(['other', 'after']);
  });

  it('saves and deletes a workspace in the file it was loaded from, whatever that file is called', async () => {
    const workspacesDir = path.join(temp.dir, 'config/workspaces');
    await writeFile(path.join(workspacesDir, 'misnamed.json'), JSON.stringify({ slug: 'team', name: 'Team' }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await temp.store.reload();

    await temp.store.saveWorkspace({ ...temp.store.requireWorkspace('team'), name: 'Renamed' });
    expect(await readdir(workspacesDir)).not.toContain('team.json');
    expect(JSON.parse(await readFile(path.join(workspacesDir, 'misnamed.json'), 'utf8')).name).toBe('Renamed');

    await temp.store.deleteWorkspace('team');
    await temp.store.reload();
    expect(temp.store.getWorkspace('team')).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('refuses to delete a workspace that is not there, naming the ones that are', async () => {
    await expect(temp.store.deleteWorkspace('nope')).rejects.toMatchObject({
      status: 404,
      message: 'Unknown workspace "nope"',
      detail: 'the workspaces are examples',
    });
  });

  it('silently prunes members that no longer exist when a workspace is saved', async () => {
    await temp.store.createSkill({ name: 'real', description: 'r', body: '# real' });
    const saved = await temp.store.saveWorkspace({
      name: 'A',
      slug: 'a',
      enabled: true,
      skills: ['real', 'ghost'],
    });
    expect(saved.skills).toEqual(['real']);
    expect(temp.store.getWorkspace('a')?.skills).toEqual(['real']);
  });
});

describe('ConfigStore skill tags', () => {
  const temp = useTempStore();

  it('persists normalized tags on create and round-trips them from disk', async () => {
    const created = await temp.store.createSkill({
      name: 'tagged',
      description: 'd',
      body: '# tagged',
      tags: [' Backend ', 'backend', 'testing', ''],
    });
    // Trimmed, empties dropped, de-duplicated case-insensitively (first casing wins).
    expect(created.tags).toEqual(['Backend', 'testing']);
    expect(temp.store.getSkill('tagged')?.tags).toEqual(['Backend', 'testing']);

    // A fresh store reading the same file sees the same tags.
    const reopened = new ConfigStore(temp.dir);
    await reopened.init();
    expect(reopened.getSkill('tagged')?.tags).toEqual(['Backend', 'testing']);
    await reopened.close();
  });

  it('replaces tags on update and clears them with an empty list', async () => {
    await temp.store.createSkill({ name: 'edit', description: 'd', body: '# edit', tags: ['one', 'two'] });

    const replaced = await temp.store.updateSkill('edit', { tags: ['three'] });
    expect(replaced.tags).toEqual(['three']);

    const cleared = await temp.store.updateSkill('edit', { tags: [] });
    expect(cleared.tags).toEqual([]);
    expect(cleared.frontmatter.tags).toBeUndefined();
  });

  it('leaves tags unchanged when the patch omits them', async () => {
    await temp.store.createSkill({ name: 'keep', description: 'd', body: '# keep', tags: ['stable'] });
    const updated = await temp.store.updateSkill('keep', { description: 'new desc' });
    expect(updated.tags).toEqual(['stable']);
  });

  it('parses comma-separated frontmatter tags written by hand', async () => {
    await mkdir(path.join(temp.dir, 'skills'), { recursive: true });
    await writeFile(
      path.join(temp.dir, 'skills', 'hand.md'),
      '---\nname: hand\ndescription: d\ntags: alpha, beta ,alpha\n---\n\n# hand\n',
    );
    await temp.store.reload();
    expect(temp.store.getSkill('hand')?.tags).toEqual(['alpha', 'beta']);
  });
});

describe('ConfigStore usage analytics', () => {
  const temp = useTempStore();

  it('reports zeros for a never-loaded skill', async () => {
    await temp.store.createSkill({ name: 'fresh', description: 'd', body: '# fresh' });
    expect(temp.store.getUsage('fresh')).toEqual({ count: 0, lastUsedAt: null });
  });

  it('counts loads and stamps lastUsedAt, persisting across a reopen', async () => {
    await temp.store.createSkill({ name: 'used', description: 'd', body: '# used' });
    temp.store.recordSkillUse('used');
    temp.store.recordSkillUse('used');

    const stats = temp.store.getUsage('used');
    expect(stats.count).toBe(2);
    expect(stats.lastUsedAt).not.toBeNull();

    // close() flushes the pending usage.json write; a fresh store reads it back.
    await temp.store.close();
    const reopened = new ConfigStore(temp.dir);
    await reopened.init();
    expect(reopened.getUsage('used')).toEqual(stats);
    await reopened.close();
  });

  it('carries usage over on rename and drops it on delete', async () => {
    await temp.store.createSkill({ name: 'before', description: 'd', body: '# before' });
    temp.store.recordSkillUse('before');

    await temp.store.renameSkill('before', 'after');
    expect(temp.store.getUsage('before')).toEqual({ count: 0, lastUsedAt: null });
    expect(temp.store.getUsage('after').count).toBe(1);

    await temp.store.deleteSkill('after');
    expect(temp.store.getUsage('after')).toEqual({ count: 0, lastUsedAt: null });
  });

  it('fires no change event when usage is recorded', async () => {
    await temp.store.createSkill({ name: 'watched', description: 'd', body: '# watched' });
    const onChange = vi.fn();
    temp.store.on('change', onChange);
    temp.store.startWatching();
    await settle();

    temp.store.recordSkillUse('watched');
    await vi.waitFor(() => expect(existsSync(path.join(temp.dir, 'usage.json'))).toBe(true), { timeout: 2000 });
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ConfigStore read-only skills', () => {
  const temp = useTempStore();

  it('defaults to writable and keeps the frontmatter clean', async () => {
    const skill = await temp.store.createSkill({ name: 'plain', description: 'd', body: 'b' });
    expect(skill.readOnly).toBe(false);
    expect(skill.frontmatter).not.toHaveProperty('readonly');
  });

  it('persists the flag to frontmatter, survives unrelated edits and a rename, and clears cleanly', async () => {
    await temp.store.createSkill({ name: 'guarded', description: 'd', body: 'b', format: 'dir' });
    expect((await temp.store.updateSkill('guarded', { readOnly: true })).readOnly).toBe(true);
    expect(await readFile(path.join(temp.dir, 'skills', 'guarded', 'SKILL.md'), 'utf8')).toContain('readonly: true');

    // The store itself stays unrestricted: a human edit (REST/UI) goes through and keeps the flag.
    expect((await temp.store.updateSkill('guarded', { body: 'edited' })).readOnly).toBe(true);
    expect((await temp.store.renameSkill('guarded', 'guarded-2')).readOnly).toBe(true);

    // Round-trips from disk.
    await temp.store.reload();
    expect(temp.store.getSkill('guarded-2')?.readOnly).toBe(true);

    const cleared = await temp.store.updateSkill('guarded-2', { readOnly: false });
    expect(cleared.readOnly).toBe(false);
    expect(cleared.frontmatter).not.toHaveProperty('readonly');
  });

  it('honours a hand-written `readonly: yes` without losing the rest of the frontmatter', async () => {
    await writeFile(
      path.join(temp.dir, 'skills', 'hand.md'),
      '---\nname: hand\ndescription: by hand\nreadonly: yes\n---\n\nbody\n',
    );
    await temp.store.reload();
    const skill = temp.store.getSkill('hand');
    expect(skill?.readOnly).toBe(true);
    expect(skill?.description).toBe('by hand');
  });
});

describe('ConfigStore git-linked skills', () => {
  const source = { repo: 'https://example.com/acme/skills.git', ref: 'main', path: 'skills/demo' };
  /** What the fake repo currently holds: file contents by path, and the commit they are at. */
  let upstream: { commit: string; files: Record<string, string> };
  /** Set to hold the next fetch open until the returned function is called. */
  let gate: Promise<void> | null;

  const fetchSource: SkillSourceFetcher = async (_source, destDir) => {
    await gate;
    for (const [rel, content] of Object.entries(upstream.files)) {
      await mkdir(path.dirname(path.join(destDir, rel)), { recursive: true });
      await writeFile(path.join(destDir, rel), content);
    }
    return { commit: upstream.commit };
  };

  const temp = useTempStore({ fetchSource });

  beforeEach(() => {
    gate = null;
    upstream = {
      commit: 'c1',
      files: {
        'SKILL.md': '---\nname: demo\ndescription: Upstream demo\ntags: [ui]\n---\n\nv1\n',
        'reference/notes.md': 'notes v1',
        'old.md': 'stale soon',
      },
    };
  });

  it('imports a linked dir skill named after the upstream frontmatter and records the commit', async () => {
    const skill = await temp.store.importSkillFromSource({ source });
    expect(skill.name).toBe('demo');
    expect(skill.format).toBe('dir');
    expect(skill.description).toBe('Upstream demo');
    expect(skill.tags).toEqual(['ui']);
    expect(skill.source).toMatchObject({ ...source, commit: 'c1' });
    expect(skill.source?.syncedAt).toBeTruthy();
    expect(filePaths(skill)).toEqual(['old.md', 'reference/notes.md']);
    // The staging area is emptied and never shows up as a skill.
    expect(await readdir(path.join(temp.dir, '.sync'))).toEqual([]);
    await temp.store.reload();
    expect(temp.store.getSkill('demo')?.source?.commit).toBe('c1');
  });

  it('falls back to the source folder name, and refuses a taken name', async () => {
    upstream.files['SKILL.md'] = 'no frontmatter\n';
    const skill = await temp.store.importSkillFromSource({ source: { ...source, path: 'skills/Fancy Skill' } });
    expect(skill.name).toBe('fancy-skill');
    await expect(temp.store.importSkillFromSource({ source, name: 'fancy-skill' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('syncs to the newest copy, dropping stale files and reporting whether anything moved', async () => {
    await temp.store.importSkillFromSource({ source });
    expect((await temp.store.syncSkill('demo')).changed).toBe(false);

    upstream = {
      commit: 'c2',
      files: { 'SKILL.md': '---\nname: demo\ndescription: Upstream v2\n---\n\nv2\n', 'new.md': 'fresh' },
    };
    const { skill, changed } = await temp.store.syncSkill('demo');
    expect(changed).toBe(true);
    expect(skill.description).toBe('Upstream v2');
    expect(skill.body.trim()).toBe('v2');
    expect(skill.source).toMatchObject({ ...source, commit: 'c2' });
    expect(filePaths(skill)).toEqual(['new.md']);
    expect(existsSync(path.join(temp.dir, 'skills/demo/old.md'))).toBe(false);
  });

  it('keeps the local name, visibility, read-only flag and workspace membership across a sync', async () => {
    await temp.store.importSkillFromSource({ source, name: 'local-name', global: false });
    await temp.store.updateSkill('local-name', { readOnly: true });
    await temp.store.addSkillToWorkspace('examples', 'local-name');

    upstream.commit = 'c2';
    const { skill } = await temp.store.syncSkill('local-name');
    expect(skill.name).toBe('local-name');
    expect(skill.global).toBe(false);
    expect(skill.readOnly).toBe(true);
    expect(temp.store.getSkill('demo')).toBeUndefined();
    await temp.store.reload();
    expect(temp.store.getWorkspace('examples')?.skills).toContain('local-name');
  });

  it('leaves the skill untouched when the source no longer has a SKILL.md', async () => {
    await temp.store.importSkillFromSource({ source });
    upstream = { commit: 'c2', files: { 'README.md': 'moved away' } };
    await expect(temp.store.syncSkill('demo')).rejects.toMatchObject({ status: 400 });
    expect(temp.store.getSkill('demo')?.source?.commit).toBe('c1');
    expect(existsSync(path.join(temp.dir, 'skills/demo/reference/notes.md'))).toBe(true);
  });

  it('links an existing flat-file skill, converting it to a folder', async () => {
    await temp.store.createSkill({ name: 'flat', description: 'local', body: 'local body', format: 'file' });
    const skill = await temp.store.linkSkillSource('flat', source);
    expect(skill.name).toBe('flat');
    expect(skill.format).toBe('dir');
    expect(skill.path).toBe('flat/SKILL.md');
    expect(skill.body.trim()).toBe('v1');
    expect(existsSync(path.join(temp.dir, 'skills/flat.md'))).toBe(false);
  });

  it('unlinks without touching the content, after which a sync is refused', async () => {
    await temp.store.importSkillFromSource({ source });
    const skill = await temp.store.unlinkSkillSource('demo');
    expect(skill.source).toBeUndefined();
    expect(skill.frontmatter).not.toHaveProperty('source');
    expect(skill.body.trim()).toBe('v1');
    expect(filePaths(skill)).toEqual(['old.md', 'reference/notes.md']);
    await expect(temp.store.syncSkill('demo')).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a second sync while one is in flight', async () => {
    await temp.store.importSkillFromSource({ source });
    let release = () => {};
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = temp.store.syncSkill('demo');
    await expect(temp.store.syncSkill('demo')).rejects.toMatchObject({ status: 409 });
    release();
    await expect(first).resolves.toMatchObject({ changed: false });
  });

  it('treats a malformed hand-edited link as not linked', async () => {
    await temp.store.createSkill({ name: 'plain', description: '', body: 'b', format: 'dir' });
    await writeFile(
      path.join(temp.dir, 'skills/plain/SKILL.md'),
      '---\nname: plain\nsource: just-a-string\n---\n\nb\n',
    );
    await temp.store.reload();
    expect(temp.store.getSkill('plain')).toBeDefined();
    expect(temp.store.getSkill('plain')?.source).toBeUndefined();
  });
});
