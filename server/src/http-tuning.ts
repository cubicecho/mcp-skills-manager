import type { Server } from 'node:http';

/** Idle time before a keep-alive connection is closed, in ms. Above the 60 s nginx and ALB hold theirs. */
export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 75_000;

/**
 * Keeps idle client connections open longer than Node's 5 s, so a tool call after a pause reuses one.
 * @param server The listening HTTP server; its `keepAliveTimeout` is set in place.
 * @param env Source of `HTTP_KEEP_ALIVE_TIMEOUT_MS`; `0` never closes an idle connection.
 * @returns The timeout applied, in ms. The default when the value is unset or not a whole number of ms.
 */
export function tuneKeepAlive(server: Server, env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.HTTP_KEEP_ALIVE_TIMEOUT_MS?.trim() || Number.NaN);
  const timeoutMs = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
  server.keepAliveTimeout = timeoutMs;
  return timeoutMs;
}
