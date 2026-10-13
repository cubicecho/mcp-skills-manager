import { createHash, timingSafeEqual } from 'node:crypto';
import type { SettingsFile } from '@mcp-skills/shared';
import { HttpStatus } from '@mcp-skills/shared';
import type { RequestHandler } from 'express';
import { EnvVar } from './core/defaults.ts';
import { sendError } from './errors.ts';

/** The effective bearer-auth state for one request. */
export interface AuthConfig {
  /** Whether requests must carry the token. */
  enabled: boolean;
  /** The token to match; null when none is configured. */
  token: string | null;
}

/** Bearer-auth state plus where its token comes from: the environment, settings.json, or nowhere. */
export interface ResolvedAuth extends AuthConfig {
  /** Where `token` was read from; `none` when there is no token. */
  tokenSource: 'env' | 'settings' | 'none';
}

/** Lower-cased environment values that count as "on". */
const TRUTHY_ENV = new Set(['1', 'true', 'yes', 'on']);

/**
 * Tells whether `SECURE_LOCAL_NET` turns bearer auth off for both /api and /mcp.
 *
 * @param [env] - Environment to read SECURE_LOCAL_NET from.
 * @returns True when it is `1`, `true`, `yes` or `on`, in any case and ignoring surrounding spaces.
 *
 * @remarks
 * It is an escape hatch for a trusted local network, where no token is minted or passed. It overrides
 * `authEnabled` in settings.json.
 */
export function authDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[EnvVar.SecureLocalNet];
  return value !== undefined && TRUTHY_ENV.has(value.trim().toLowerCase());
}

/**
 * Tells whether bearer auth is actually enforced: on in settings and not overridden by SECURE_LOCAL_NET.
 *
 * @param settings - Settings carrying the `authEnabled` flag.
 * @param [env] - Environment to read SECURE_LOCAL_NET from.
 * @returns True when requests must carry the token.
 */
export function isAuthEffective(
  settings: Pick<SettingsFile, 'authEnabled'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return settings.authEnabled && !authDisabledByEnv(env);
}

/**
 * Works out the auth state in force.
 *
 * @param settings - Settings carrying `authEnabled` and the stored token.
 * @param [env] - Environment to read MCP_SKILLS_TOKEN and SECURE_LOCAL_NET from.
 * @returns Whether auth is enforced, and the token to match with its source: MCP_SKILLS_TOKEN beats settings.json.
 *
 * @remarks
 * This is the one place that decides which token wins, so the middleware, the token generator and the
 * startup log cannot disagree. An empty MCP_SKILLS_TOKEN counts as unset.
 */
export function resolveAuth(
  settings: Pick<SettingsFile, 'authEnabled' | 'authToken'>,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAuth {
  const enabled = isAuthEffective(settings, env);
  const envToken = env[EnvVar.Token];
  if (envToken) {
    return { enabled, token: envToken, tokenSource: 'env' };
  }
  if (settings.authToken) {
    return { enabled, token: settings.authToken, tokenSource: 'settings' };
  }
  return { enabled, token: null, tokenSource: 'none' };
}

/**
 * Compares two tokens in constant time, without leaking their length: it compares their sha256 digests.
 *
 * @param a - One token.
 * @param b - The other.
 * @returns True when the tokens are the same string.
 */
function tokensEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Builds the bearer-token middleware for /api and /mcp.
 *
 * @param getAuth - Reads the auth state in force; called on every request, so a settings change applies at once.
 * @returns A handler that answers 401 unless the `Authorization: Bearer` header carries the token.
 *
 * @remarks
 * With auth off every request passes; with auth on and no token configured, every request is refused.
 */
export function createAuthMiddleware(getAuth: () => AuthConfig): RequestHandler {
  return (req, res, next) => {
    const { enabled, token } = getAuth();
    if (!enabled) {
      next();
      return;
    }
    if (!token) {
      sendError(res, HttpStatus.Unauthorized, 'Auth is enabled but no token is configured');
      return;
    }
    const header = req.headers.authorization;
    const provided = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!provided || !tokensEqual(provided, token)) {
      sendError(res, HttpStatus.Unauthorized, 'Unauthorized');
      return;
    }
    next();
  };
}
