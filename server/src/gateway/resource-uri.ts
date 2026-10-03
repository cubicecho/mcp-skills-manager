import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/** URI scheme under which skills are exposed as MCP resources. */
export const RESOURCE_SCHEME = 'skill';

/** RFC 6570 URI template for a skill's primary document, advertised via `resources/templates/list`. */
export const SKILL_URI_TEMPLATE = `${RESOURCE_SCHEME}://{name}`;

/**
 * RFC 6570 URI template for a bundled file. It uses reserved expansion (`{+path}`)
 * so nested paths with `/` expand literally rather than being percent-encoded.
 */
export const SKILL_FILE_URI_TEMPLATE = `${RESOURCE_SCHEME}://{name}/{+path}`;

/**
 * MCP's spec-defined "resource not found" JSON-RPC error code. It is absent from
 * the SDK's `ErrorCode` enum, so we spell it out; the spec asks servers to return
 * it (with the offending URI in `data`) for unknown resources rather than the
 * generic `InvalidParams`.
 */
const RESOURCE_NOT_FOUND = -32002;

/** A spec-compliant resource-not-found error carrying the offending URI in `data`. */
export function resourceNotFound(uri: string): McpError {
  return new McpError(RESOURCE_NOT_FOUND, `Unknown skill resource "${uri}"`, { uri });
}

/** The `skill://<name>` resource URI for a skill's primary document. Names are slugs, already URI-safe. */
export function skillResourceUri(name: string): string {
  return `${RESOURCE_SCHEME}://${name}`;
}

/**
 * The `skill://<name>/<path>` URI for a bundled supporting file, percent-encoding
 * each path segment (but not the `/` separators) so the advertised URI round-trips
 * cleanly through the read handler's `decodeURIComponent` — filenames with spaces,
 * `%`, `#`, etc. survive intact.
 */
export function fileResourceUri(name: string, relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${skillResourceUri(name)}/${encoded}`;
}

/**
 * Max resources returned per `resources/list` page. The list is rebuilt from live
 * state each call, so the cursor is a plain offset — a mutation between pages can
 * shift entries, which is acceptable under MCP's opaque-cursor semantics.
 */
export const RESOURCE_PAGE_SIZE = 100;

/** Encode a list offset as an opaque pagination cursor. */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

/** Decode a pagination cursor back to an offset; a malformed cursor is an `InvalidParams` error. */
export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const offset = Number.parseInt(decoded, 10);
  const isCanonicalOffset = Number.isInteger(offset) && offset >= 0 && String(offset) === decoded;
  if (!isCanonicalOffset) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid pagination cursor "${cursor}"`);
  }
  return offset;
}

/**
 * `decodeURIComponent`, but a malformed percent-escape (e.g. a lone `%`) surfaces
 * as a clean `InvalidParams` MCP error instead of a raw `URIError` that would
 * escape as a transport-level exception.
 */
export function decodeResourcePart(part: string, uri: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new McpError(ErrorCode.InvalidParams, `Unknown skill resource "${uri}"`);
  }
}
