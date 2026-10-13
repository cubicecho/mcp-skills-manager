import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/** URI scheme under which skills are exposed as MCP resources. */
export const RESOURCE_SCHEME = 'skill';

/** RFC 6570 URI template for a skill's primary document, advertised via `resources/templates/list`. */
export const SKILL_URI_TEMPLATE = `${RESOURCE_SCHEME}://{name}`;

/**
 * RFC 6570 URI template for a bundled file.
 *
 * @remarks
 * It uses reserved expansion (`{+path}`) so nested paths with `/` expand literally rather than percent-encoded.
 */
export const SKILL_FILE_URI_TEMPLATE = `${RESOURCE_SCHEME}://{name}/{+path}`;

/**
 * MCP's spec-defined "resource not found" JSON-RPC error code, which the SDK's `ErrorCode` enum lacks.
 *
 * @remarks
 * The spec asks servers to answer an unknown resource with it, and the URI in `data`, rather than `InvalidParams`.
 */
const RESOURCE_NOT_FOUND = -32002;

/**
 * Builds the spec's resource-not-found error.
 *
 * @param uri - The URI that names no resource; carried in the error's `data`.
 * @returns The error to throw.
 */
export function resourceNotFound(uri: string): McpError {
  return new McpError(RESOURCE_NOT_FOUND, `Unknown skill resource "${uri}"`, { uri });
}

/**
 * Builds the `skill://<name>` resource URI of a skill's primary document.
 *
 * @param name - The skill's name; a slug, so already URI-safe.
 * @returns The URI.
 */
export function skillResourceUri(name: string): string {
  return `${RESOURCE_SCHEME}://${name}`;
}

/**
 * Builds the `skill://<name>/<path>` resource URI of a bundled supporting file.
 *
 * @param name - The skill's name.
 * @param relPath - The file's path, relative to the skill directory.
 * @returns The URI, with each path segment percent-encoded and the `/` separators kept.
 *
 * @remarks
 * The encoding lets a file name holding a space, `%` or `#` survive the read handler's `decodeURIComponent`.
 */
export function fileResourceUri(name: string, relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${skillResourceUri(name)}/${encoded}`;
}

/**
 * Max resources returned per `resources/list` page.
 *
 * @remarks
 * The list is rebuilt from live state on each call, so the cursor is a plain offset. A change between pages can
 * shift entries, which MCP's opaque-cursor semantics allow.
 */
export const RESOURCE_PAGE_SIZE = 100;

/**
 * Encodes a list offset as an opaque pagination cursor.
 *
 * @param offset - Index of the first entry of the page the cursor points at.
 * @returns The cursor.
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

/**
 * Decodes a pagination cursor back to an offset.
 *
 * @param cursor - The cursor a client sent; `undefined` asks for the first page.
 * @returns The offset, 0 for no cursor. Throws an `InvalidParams` McpError for a malformed cursor.
 */
export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const offset = Number.parseInt(decoded, 10);
  const isCanonicalOffset = Number.isInteger(offset) && offset >= 0 && String(offset) === decoded;
  if (isCanonicalOffset === false) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid pagination cursor "${cursor}"`);
  }
  return offset;
}

/**
 * Percent-decodes one part of a resource URI.
 *
 * @param part - The skill name or the file path, still encoded.
 * @param uri - The whole URI, named in the error.
 * @returns The decoded part.
 *
 * @remarks
 * A malformed percent-escape, such as a lone `%`, names no resource, so it is thrown as the resource-not-found
 * McpError rather than the raw `URIError`, which would escape as a transport-level exception.
 */
export function decodeResourcePart(part: string, uri: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw resourceNotFound(uri);
  }
}

/** What a `skill://` resource URI names: a skill's own document, or one of its bundled files. */
export interface ParsedResourceUri {
  /** The skill's name; empty when the URI names none. */
  skill: string;
  /** The bundled file's path relative to the skill's folder; absent for the skill's own document. */
  path?: string;
}

/**
 * Takes a `skill://<name>` or `skill://<name>/<path>` URI apart.
 *
 * @param uri - The URI a client asked for.
 * @returns The skill it names, and the bundled file when it names one.
 * @throws McpError resource-not-found for another scheme, InvalidParams for a malformed percent-escape.
 */
export function parseResourceUri(uri: string): ParsedResourceUri {
  const prefix = `${RESOURCE_SCHEME}://`;
  if (uri.startsWith(prefix) === false) {
    throw resourceNotFound(uri);
  }
  // Drop any URI query/fragment before parsing the path — a raw `?`/`#`
  // delimits them (a literal `?`/`#` in a filename would be percent-encoded).
  const rest = uri.slice(prefix.length).replace(/[?#].*$/, '');
  // Skill names never contain "/", so the first slash cleanly separates the
  // skill name from a bundled-file path: skill://<name> vs skill://<name>/<path>.
  const slash = rest.indexOf('/');
  if (slash === -1) {
    return { skill: decodeResourcePart(rest, uri) };
  }
  return {
    skill: decodeResourcePart(rest.slice(0, slash), uri),
    path: decodeResourcePart(rest.slice(slash + 1), uri),
  };
}
