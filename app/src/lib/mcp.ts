/**
 * The origin an MCP client should connect to.
 *
 * In production the web UI is served by the MCP server itself, so
 * `window.location.origin` is correct — including behind a reverse proxy, where
 * the server's internal port is irrelevant. In dev the UI is served by Vite on
 * a different port (3000) than the server (3001), so `window.location.origin`
 * would advertise the Vite port; we swap in the server's actual listening port
 * (reported by GET /api/status) on the current hostname instead.
 *
 * The dev branch is gated on `import.meta.env.DEV`, so production builds always
 * use the page origin regardless of what port the server reports.
 */
export function mcpOrigin(serverPort?: number): string {
  if (import.meta.env.DEV && serverPort && serverPort !== Number(window.location.port)) {
    return `${window.location.protocol}//${window.location.hostname}:${serverPort}`;
  }
  return window.location.origin;
}
