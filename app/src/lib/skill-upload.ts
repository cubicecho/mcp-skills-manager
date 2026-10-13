import type { SkillFileContent, SkillFormat } from '@mcp-skills/shared';
import { slugify } from '@mcp-skills/shared';
import { unzipSync } from 'fflate';
import type { PickedFile } from '@/components/ui/file-picker-base';

/**
 * A skill upload as normalized on the client. An `.md` file, a picked folder,
 * or a `.zip` archive are all reduced to a `format` plus a flat list of files
 * (base64-encoded) that the POST /api/skills/import endpoint understands.
 */
export interface NormalizedUpload {
  format: SkillFormat;
  /** Slug derived from the file / folder / archive name; user-editable before import. */
  defaultName: string;
  /** The files to import, base64-encoded; empty when `error` is set. */
  files: SkillFileContent[];
  /** Relative paths, for preview. */
  paths: string[];
  /** Set when the upload could not be normalized (e.g. a directory with no SKILL.md). */
  error?: string;
}

/** One uploaded file before encoding: its path and raw bytes. */
interface RawFile {
  path: string;
  bytes: Uint8Array;
}

/**
 * Encodes bytes as base64, in chunks so a large file does not overflow the call stack.
 *
 * @param bytes - The bytes to encode.
 * @returns The base64 string.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Turns a raw file into an import payload entry.
 *
 * @param file - The file to encode.
 * @returns The entry, its content base64-encoded.
 */
function toContent(file: RawFile): SkillFileContent {
  return { path: file.path, content: bytesToBase64(file.bytes), encoding: 'base64' };
}

/**
 * Drops a top-level directory every file shares, so `myskill/SKILL.md` becomes `SKILL.md`.
 *
 * @param files - The uploaded files.
 * @returns The directory's name and the files without it, or a null `root` and the files as given when none is shared.
 */
function stripCommonRoot(files: RawFile[]): { root: string | null; files: RawFile[] } {
  const tops = new Set(files.map((f) => (f.path.includes('/') ? f.path.slice(0, f.path.indexOf('/')) : '')));
  if (tops.size === 1 && tops.has('') === false) {
    const root = [...tops][0] ?? '';
    return { root, files: files.map((f) => ({ ...f, path: f.path.slice(root.length + 1) })) };
  }
  return { root: null, files };
}

/**
 * Ensures a directory skill has a `SKILL.md` at its root, renaming the only root-level `.md` file to it when
 * there is exactly one.
 *
 * @param files - The skill's files, relative to its root.
 * @returns The files with a `SKILL.md` among them, or null when none can be told to be it.
 */
function ensureSkillMd(files: RawFile[]): RawFile[] | null {
  if (files.some((f) => f.path === 'SKILL.md')) {
    return files;
  }
  const rootMarkdown = files.filter((f) => f.path.includes('/') === false && f.path.toLowerCase().endsWith('.md'));
  if (rootMarkdown.length === 1) {
    const chosen = rootMarkdown[0];
    return files.map((f) => (f === chosen ? { ...f, path: 'SKILL.md' } : f));
  }
  return null;
}

/**
 * Removes an extension from a file name, whatever the name's case.
 *
 * @param fileName - The name to shorten.
 * @param ext - The lower-case extension to remove, dot included.
 * @returns The name without the extension, or unchanged when it does not end in it.
 */
function stripExtension(fileName: string, ext: string): string {
  return fileName.toLowerCase().endsWith(ext) ? fileName.slice(0, -ext.length) : fileName;
}

/**
 * Reduces a file picked with `read="bytes"` to its path and bytes.
 *
 * @param file - The picked file.
 * @returns Its path (inside the picked folder, or its name outside one) and bytes, empty when none were read.
 */
function toRawFile(file: PickedFile): RawFile {
  return { path: file.path, bytes: file.bytes ?? new Uint8Array() };
}

/**
 * Turns a file picked with `read="bytes"` into an import payload entry.
 *
 * @param file - The picked file.
 * @returns The entry at the file's own path, base64-encoded.
 */
export function pickedToSkillFileContent(file: PickedFile): SkillFileContent {
  return toContent(toRawFile(file));
}

/**
 * Normalizes a set of files into a directory skill.
 *
 * @param rawFiles - The files of a folder or archive; entries with an empty path or a trailing `/` are dropped.
 * @param fallbackName - Slugified into the default name when the files share no top-level directory.
 * @returns The upload, with `error` set and no files when no `SKILL.md` can be found.
 */
function normalizeDirectory(rawFiles: RawFile[], fallbackName: string): NormalizedUpload {
  const nonEmpty = rawFiles.filter((f) => f.path && f.path.endsWith('/') === false);
  const { root, files: stripped } = stripCommonRoot(nonEmpty);
  const withSkillMd = ensureSkillMd(stripped);
  const defaultName = slugify(root ?? fallbackName);
  if (!withSkillMd) {
    return {
      format: 'dir',
      defaultName,
      files: [],
      paths: stripped.map((f) => f.path).sort(),
      error: 'No SKILL.md found. A directory skill needs a SKILL.md at its root (or a single Markdown file).',
    };
  }
  return {
    format: 'dir',
    defaultName,
    files: withSkillMd.map(toContent),
    paths: withSkillMd.map((f) => f.path).sort(),
  };
}

/**
 * Normalizes a single picked file: `.md` or `.markdown` into a file skill, `.zip` into a directory skill.
 *
 * @param file - The picked file, read as bytes.
 * @returns The upload, with `error` set for an empty archive or any other kind of file.
 */
export function normalizeUploadFile(file: PickedFile): NormalizedUpload {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.zip')) {
    const entries = unzipSync(toRawFile(file).bytes);
    const rawFiles: RawFile[] = Object.entries(entries)
      .filter(([name]) => name.endsWith('/') === false)
      .map(([name, data]) => ({ path: name, bytes: data }));
    if (rawFiles.length === 0) {
      return { format: 'dir', defaultName: '', files: [], paths: [], error: 'The archive is empty.' };
    }
    return normalizeDirectory(rawFiles, stripExtension(file.name, '.zip'));
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return {
      format: 'file',
      defaultName: slugify(stripExtension(stripExtension(file.name, '.markdown'), '.md')),
      files: [toContent({ path: 'SKILL.md', bytes: toRawFile(file).bytes })],
      paths: [file.name],
    };
  }
  return {
    format: 'file',
    defaultName: '',
    files: [],
    paths: [file.name],
    error: 'Unsupported file. Choose a .md file or a .zip archive.',
  };
}

/**
 * Normalizes a picked folder into a directory skill.
 *
 * @param files - Every file of the folder, read as bytes.
 * @returns The upload, named after the folder.
 */
export function normalizeUploadFolder(files: PickedFile[]): NormalizedUpload {
  return normalizeDirectory(files.map(toRawFile), '');
}
