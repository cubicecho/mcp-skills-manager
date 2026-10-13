// Every fixed value someone might tune, as plain data. Nothing here computes, reads the environment or imports.

/** Idle time before an inbound keep-alive connection is closed, in ms. `HTTP_KEEP_ALIVE_TIMEOUT_MS` overrides it. */
export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 75_000;

/** Largest JSON body /api and /mcp accept, as `express.json` reads it; uploads carry base64 files inline. */
export const BODY_LIMIT = '25mb';

/** How long on-disk changes are gathered before the store reloads, in ms. */
export const WATCH_DEBOUNCE_MS = 300;

/** How long recorded skill uses are gathered before they are written, in ms. */
export const USAGE_FLUSH_MS = 500;

/** Random bytes in a generated auth token; it is written as twice as many hex characters. */
export const AUTH_TOKEN_BYTES = 32;

/** How long one git command may run, in ms. */
export const GIT_TIMEOUT_MS = 60_000;

/** Most output one git command may write before it is cut off, in bytes: 16 MiB. */
export const GIT_MAX_BUFFER_BYTES = 16_777_216;

/** How much of git's stderr is kept for an error's detail, in characters. */
export const GIT_STDERR_TAIL_LENGTH = 600;

/** The environment variables the server reads. */
export const EnvVar = {
  DataDir: 'DATA_DIR',
  Port: 'PORT',
  Token: 'MCP_SKILLS_TOKEN',
  SecureLocalNet: 'SECURE_LOCAL_NET',
  KeepAliveTimeoutMs: 'HTTP_KEEP_ALIVE_TIMEOUT_MS',
  GitSshCommand: 'GIT_SSH_COMMAND',
} as const;
