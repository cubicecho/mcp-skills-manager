import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { PickedFile } from '@/components/ui/file-picker-base';
import { normalizeUploadFile, normalizeUploadFolder, pickedToSkillFileContent } from './skill-upload';

/** A file as the picker hands it over with `read="bytes"`. */
function picked(path: string, content: string | Uint8Array = ''): PickedFile {
  const bytes = typeof content === 'string' ? strToU8(content) : content;
  return { name: path.slice(path.lastIndexOf('/') + 1), path, type: '', size: bytes.length, text: '', bytes };
}

/** A `.zip` holding the given files, as picked. */
function pickedZip(name: string, files: Record<string, string>): PickedFile {
  const entries = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)]));
  return picked(name, zipSync(entries));
}

const decode = (base64: string) => atob(base64);

describe('pickedToSkillFileContent', () => {
  it('sends a file base64-encoded at its folder-relative path', () => {
    expect(pickedToSkillFileContent(picked('docs/intro.md', '# Hi'))).toEqual({
      path: 'docs/intro.md',
      content: btoa('# Hi'),
      encoding: 'base64',
    });
  });

  it('keeps every byte of a file larger than one encoding chunk', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 5).map((_, index) => index % 256);
    const { content } = pickedToSkillFileContent(picked('big.bin', bytes));
    const decoded = Uint8Array.from(decode(content), (char) => char.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });

  it('sends a file picked without its bytes as empty', () => {
    const { bytes: _bytes, ...withoutBytes } = picked('empty.md', 'ignored');
    expect(pickedToSkillFileContent(withoutBytes).content).toBe('');
  });
});

describe('normalizeUploadFile', () => {
  it('reads a Markdown file as a file skill named after it', () => {
    const upload = normalizeUploadFile(picked('My Skill.MD', '# Hello'));
    expect(upload).toEqual({
      format: 'file',
      defaultName: 'my-skill',
      files: [{ path: 'SKILL.md', content: btoa('# Hello'), encoding: 'base64' }],
      paths: ['My Skill.MD'],
    });
  });

  it('takes .markdown as Markdown too', () => {
    const upload = normalizeUploadFile(picked('notes.markdown', 'x'));
    expect(upload.format).toBe('file');
    expect(upload.defaultName).toBe('notes');
    expect(upload.error).toBeUndefined();
  });

  it('refuses a file that is neither Markdown nor a zip', () => {
    expect(normalizeUploadFile(picked('notes.txt', 'x'))).toEqual({
      format: 'file',
      defaultName: '',
      files: [],
      paths: ['notes.txt'],
      error: 'Unsupported file. Choose a .md file or a .zip archive.',
    });
  });

  it('reads a zip as a directory skill, dropping the folder every file shares', () => {
    const upload = normalizeUploadFile(
      pickedZip('download.zip', { 'my-skill/SKILL.md': '# Skill', 'my-skill/docs/a.md': 'a' }),
    );
    expect(upload.format).toBe('dir');
    expect(upload.defaultName).toBe('my-skill');
    expect(upload.paths).toEqual(['SKILL.md', 'docs/a.md']);
    expect(upload.files.map((file) => [file.path, decode(file.content)])).toEqual([
      ['SKILL.md', '# Skill'],
      ['docs/a.md', 'a'],
    ]);
    expect(upload.error).toBeUndefined();
  });

  it('names a zip with no shared folder after the archive', () => {
    const upload = normalizeUploadFile(pickedZip('My Notes.ZIP', { 'SKILL.md': '# Skill', 'docs/a.md': 'a' }));
    expect(upload.defaultName).toBe('my-notes');
    expect(upload.paths).toEqual(['SKILL.md', 'docs/a.md']);
  });

  it('takes the only root Markdown file of a zip as its SKILL.md', () => {
    const upload = normalizeUploadFile(pickedZip('skill.zip', { 'readme.MD': '# Skill', 'docs/a.md': 'a' }));
    expect(upload.paths).toEqual(['SKILL.md', 'docs/a.md']);
    expect(upload.error).toBeUndefined();
  });

  it('refuses a zip with no SKILL.md and no single root Markdown file, still listing what it holds', () => {
    const upload = normalizeUploadFile(pickedZip('skill.zip', { 'a.md': 'a', 'b.md': 'b' }));
    expect(upload.files).toEqual([]);
    expect(upload.paths).toEqual(['a.md', 'b.md']);
    expect(upload.error).toBe(
      'No SKILL.md found. A directory skill needs a SKILL.md at its root (or a single Markdown file).',
    );
  });

  it('refuses an empty zip', () => {
    expect(normalizeUploadFile(pickedZip('empty.zip', {}))).toEqual({
      format: 'dir',
      defaultName: '',
      files: [],
      paths: [],
      error: 'The archive is empty.',
    });
  });
});

describe('normalizeUploadFolder', () => {
  it('reads a picked folder as a directory skill named after the folder', () => {
    const upload = normalizeUploadFolder([picked('My Skill/SKILL.md', '# Skill'), picked('My Skill/assets/logo.svg')]);
    expect(upload.format).toBe('dir');
    expect(upload.defaultName).toBe('my-skill');
    expect(upload.paths).toEqual(['SKILL.md', 'assets/logo.svg']);
    expect(upload.error).toBeUndefined();
  });

  it('refuses a folder with no SKILL.md', () => {
    const upload = normalizeUploadFolder([picked('pack/a.txt'), picked('pack/b.txt')]);
    expect(upload.defaultName).toBe('pack');
    expect(upload.files).toEqual([]);
    expect(upload.error).toMatch(/^No SKILL\.md found/);
  });
});
