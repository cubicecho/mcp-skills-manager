import type { SkillFileContent } from '@mcp-skills/shared';
import { slugifySkillName } from '@mcp-skills/shared';
import { unzipSync } from 'fflate';

/**
 * Client-side normalization of a skill upload. An `.md` file, a picked folder,
 * or a `.zip` archive are all reduced to a `format` plus a flat list of files
 * (base64-encoded) that the POST /api/skills/import endpoint understands.
 */
export interface NormalizedUpload {
  format: 'file' | 'dir';
  /** Slug derived from the file / folder / archive name; user-editable before import. */
  defaultName: string;
  files: SkillFileContent[];
  /** Relative paths, for preview. */
  paths: string[];
  /** Set when the upload could not be normalized (e.g. a directory with no SKILL.md). */
  error?: string;
}

interface RawFile {
  path: string;
  bytes: Uint8Array;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function toContent(file: RawFile): SkillFileContent {
  return { path: file.path, content: bytesToBase64(file.bytes), encoding: 'base64' };
}

/** Drop a single shared top-level directory so `myskill/SKILL.md` becomes `SKILL.md`. Returns the stripped name too. */
function stripCommonRoot(files: RawFile[]): { root: string | null; files: RawFile[] } {
  const tops = new Set(files.map((f) => (f.path.includes('/') ? f.path.slice(0, f.path.indexOf('/')) : '')));
  if (tops.size === 1 && !tops.has('')) {
    const root = [...tops][0] ?? '';
    return { root, files: files.map((f) => ({ ...f, path: f.path.slice(root.length + 1) })) };
  }
  return { root: null, files };
}

/**
 * Ensure a directory skill has a `SKILL.md` at its root. If it does not but
 * exactly one root-level `.md` file exists, that file is treated as the SKILL.md.
 * Returns null when the archive/folder is too ambiguous to import.
 */
function ensureSkillMd(files: RawFile[]): RawFile[] | null {
  if (files.some((f) => f.path === 'SKILL.md')) {
    return files;
  }
  const rootMarkdown = files.filter((f) => !f.path.includes('/') && f.path.toLowerCase().endsWith('.md'));
  if (rootMarkdown.length === 1) {
    const chosen = rootMarkdown[0];
    return files.map((f) => (f === chosen ? { ...f, path: 'SKILL.md' } : f));
  }
  return null;
}

function stripExtension(fileName: string, ext: string): string {
  return fileName.toLowerCase().endsWith(ext) ? fileName.slice(0, -ext.length) : fileName;
}

async function readRawFile(file: File): Promise<RawFile> {
  return { path: file.webkitRelativePath || file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** Read a picked File into an import payload entry. Uses its folder-relative path when available. */
export async function fileToSkillFileContent(file: File, relativePath?: string): Promise<SkillFileContent> {
  const raw = await readRawFile(file);
  return toContent({ path: relativePath ?? raw.path, bytes: raw.bytes });
}

function normalizeDirectory(rawFiles: RawFile[], fallbackName: string): NormalizedUpload {
  const nonEmpty = rawFiles.filter((f) => f.path && !f.path.endsWith('/'));
  const { root, files: stripped } = stripCommonRoot(nonEmpty);
  const withSkillMd = ensureSkillMd(stripped);
  const defaultName = slugifySkillName(root ?? fallbackName);
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

/** Normalize a single picked file: `.md` → a file skill, `.zip` → a directory skill. */
export async function normalizeUploadFile(file: File): Promise<NormalizedUpload> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.zip')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = unzipSync(bytes);
    const rawFiles: RawFile[] = Object.entries(entries)
      .filter(([name]) => !name.endsWith('/'))
      .map(([name, data]) => ({ path: name, bytes: data }));
    if (rawFiles.length === 0) {
      return { format: 'dir', defaultName: '', files: [], paths: [], error: 'The archive is empty.' };
    }
    return normalizeDirectory(rawFiles, stripExtension(file.name, '.zip'));
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    const raw = await readRawFile(file);
    return {
      format: 'file',
      defaultName: slugifySkillName(stripExtension(stripExtension(file.name, '.markdown'), '.md')),
      files: [toContent({ path: 'SKILL.md', bytes: raw.bytes })],
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

/** Normalize a picked folder (from a webkitdirectory input) into a directory skill. */
export async function normalizeUploadFolder(fileList: FileList): Promise<NormalizedUpload> {
  const rawFiles = await Promise.all([...fileList].map(readRawFile));
  return normalizeDirectory(rawFiles, '');
}
