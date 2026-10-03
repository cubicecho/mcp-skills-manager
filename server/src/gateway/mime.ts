/**
 * Extension → MIME type for bundled supporting files. Purely extension-driven so
 * the resource *listing* and the resource *read* agree on the type (the read
 * path decides blob-vs-text from the actual `binary` flag, independent of this).
 * Returns `undefined` for unknown extensions — we omit the mimeType rather than
 * guess `text/plain` and mislabel a binary blob.
 */
const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  py: 'text/x-python',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/x-typescript',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  toml: 'application/toml',
  sh: 'application/x-sh',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

/** Best-effort MIME type for a bundled supporting file; `undefined` when the extension is unrecognized. */
export function fileMimeType(relPath: string): string | undefined {
  const dot = relPath.lastIndexOf('.');
  if (dot === -1) {
    return undefined;
  }
  return MIME_BY_EXT[relPath.slice(dot + 1).toLowerCase()];
}
