/**
 * Works out the origin an MCP client should connect to.
 *
 * @param [serverPort] - The port the server listens on, as GET /api/status reports it.
 * @returns The page's origin, or in a dev build the page's hostname on `serverPort` when the two ports differ.
 *
 * @remarks
 * In production the server serves the UI itself, so the page origin is right, behind a reverse proxy too. In dev
 * Vite serves the UI on another port, and the page origin would advertise Vite's.
 */
export function mcpOrigin(serverPort?: number): string {
  if (import.meta.env.DEV && serverPort && serverPort !== Number(window.location.port)) {
    return `${window.location.protocol}//${window.location.hostname}:${serverPort}`;
  }
  return window.location.origin;
}
