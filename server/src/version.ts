import { readFileSync } from 'node:fs';

/**
 * Reads the server's version from the root package.json.
 *
 * @returns The `version` string, or `0.0.0` when the file cannot be read or holds none.
 *
 * @remarks
 * semantic-release bumps that file (via `@semantic-release/npm`) at release time, and the Dockerfile
 * copies it into the runtime image. The path is two levels up from this module in both dev
 * (`server/src/version.ts`) and prod (`server/dist/version.js`), so it resolves to the root in both.
 */
function readVersion(): string {
  try {
    const pkgUrl = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Version reported in ServerStatus and MCP server info, read once when the module loads. */
export const SERVER_VERSION = readVersion();
