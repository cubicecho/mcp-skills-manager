import type { Server } from 'node:http';
import { DEFAULT_KEEP_ALIVE_TIMEOUT_MS, EnvVar } from './core/defaults.ts';

/**
 * Keeps idle client connections open longer than Node's 5 s, so a tool call after a pause reuses one.
 * @param server The listening HTTP server; its `keepAliveTimeout` is set in place.
 * @param env Source of `HTTP_KEEP_ALIVE_TIMEOUT_MS`; `0` never closes an idle connection.
 * @returns The timeout applied, in ms. The default when the value is unset or not a whole number of ms.
 */
export function tuneKeepAlive(server: Server, env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env[EnvVar.KeepAliveTimeoutMs]?.trim() || Number.NaN);
  const timeoutMs = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
  server.keepAliveTimeout = timeoutMs;
  return timeoutMs;
}

/** The highest TCP port number. */
const MAX_PORT = 65_535;

/**
 * Pick the port to listen on: `PORT` when it names one, else the port in settings.
 * @param settingsPort The `port` from settings.json.
 * @param env Source of `PORT`; `0` asks the OS for any free port.
 * @returns `PORT` when it is a whole number from 0 to 65535, else `settingsPort` (unset, empty or not a port).
 */
export function resolvePort(settingsPort: number, env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env[EnvVar.Port]?.trim() || Number.NaN);
  const isPort = Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_PORT;
  return isPort ? parsed : settingsPort;
}
