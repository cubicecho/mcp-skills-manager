import { createHash, timingSafeEqual } from 'node:crypto';
import type { SettingsFile } from '@mcp-skills/shared';
import { HttpStatus } from '@mcp-skills/shared';
import type { RequestHandler } from 'express';
import { EnvVar } from './core/defaults.ts';

/** The effective bearer-auth state for one request. */
export interface AuthConfig {
  enabled: boolean;
  token: string | null;
}

/** Bearer-auth state plus where its token comes from: the environment, settings.json, or nowhere. */
export interface ResolvedAuth extends AuthConfig {
  tokenSource: 'env' | 'settings' | 'none';
}

/** Lower-cased environment values that count as "on". */
const TRUTHY_ENV = new Set(['1', 'true', 'yes', 'on']);

/**
 * `SECURE_LOCAL_NET=true` disables bearer auth entirely for both /api and /mcp
 * — an escape hatch for running on a trusted local network without minting or
 * passing tokens. Overrides `authEnabled` in settings.json.
 */
export function authDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[EnvVar.SecureLocalNet];
  return value !== undefined && TRUTHY_ENV.has(value.trim().toLowerCase());
}

/**
 * Tells whether bearer auth is actually enforced: on in settings and not overridden by SECURE_LOCAL_NET.
 * @param settings Settings carrying the `authEnabled` flag.
 * @param env Environment to read SECURE_LOCAL_NET from.
 * @returns True when requests must carry the token.
 */
export function isAuthEffective(
  settings: Pick<SettingsFile, 'authEnabled'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return settings.authEnabled && !authDisabledByEnv(env);
}

/**
 * Work out the auth state in force. This is the one place that decides which token wins, so the
 * middleware, the token generator and the startup log cannot disagree.
 * @param settings - Settings carrying `authEnabled` and the stored token.
 * @param env - Environment to read MCP_SKILLS_TOKEN and SECURE_LOCAL_NET from.
 * @returns Whether auth is enforced, and the token to match with its source. An empty MCP_SKILLS_TOKEN counts as unset.
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

/** Constant-time comparison that does not leak token length (compares sha256 digests). */
export function tokensEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Bearer-token middleware for /api and /mcp. Skipped entirely when auth is
 * disabled; otherwise rejects with a 401 JSON envelope.
 */
export function createAuthMiddleware(getAuth: () => AuthConfig): RequestHandler {
  return (req, res, next) => {
    const { enabled, token } = getAuth();
    if (!enabled) {
      next();
      return;
    }
    if (!token) {
      res.status(HttpStatus.Unauthorized).json({ error: 'Auth is enabled but no token is configured' });
      return;
    }
    const header = req.headers.authorization;
    const provided = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!provided || !tokensEqual(provided, token)) {
      res.status(HttpStatus.Unauthorized).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
