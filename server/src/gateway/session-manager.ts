import { randomUUID } from 'node:crypto';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { errorMessage } from '../errors.ts';

interface Session {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

/**
 * Manages long-lived MCP sessions for the **stateful** Streamable-HTTP transport,
 * so the server can push resource notifications (`list_changed` / `updated`) to a
 * connected client over SSE — the HTTP analog of stdio's live updates. Each
 * session owns a persistent `Server` + transport keyed by the `Mcp-Session-Id` the
 * transport mints on initialize, and is torn down when the client disconnects or
 * sends a DELETE. (The stateless path in `routes.ts` stays the default; this only
 * runs when `settings.httpLiveUpdates` is on.)
 */
export class McpSessionManager {
  private readonly sessions = new Map<string, Session>();

  /**
   * Route one HTTP request through a persistent session:
   * - a request bearing a known `Mcp-Session-Id` reuses that session's transport;
   * - an initialize request without a session id opens a fresh one (its `Server`
   *   built lazily via `buildServer`, then connected);
   * - anything else has no session to attach to → 400 (unknown id → 404).
   */
  async handle(req: Request, res: Response, buildServer: () => Server): Promise<void> {
    const header = req.headers['mcp-session-id'];
    const id = typeof header === 'string' ? header : undefined;

    if (id) {
      const existing = this.sessions.get(id);
      if (!existing) {
        res.status(404).json({ error: `Unknown MCP session "${id}"` });
        return;
      }
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: 'Missing Mcp-Session-Id header (send an initialize request to open a session)' });
      return;
    }

    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // JSON for the POST response (as in stateless mode); server→client
      // notifications still flow over the client's standalone GET SSE stream.
      enableJsonResponse: true,
      onsessioninitialized: (newId) => {
        this.sessions.set(newId, { server, transport });
      },
    });
    // On disconnect / DELETE: drop the session and close its server, which fires
    // the skill server's onclose hook to unsubscribe the store change listener.
    transport.onclose = () => {
      const closedId = transport.sessionId;
      if (closedId) {
        this.sessions.delete(closedId);
      }
      server.close().catch((err: unknown) => console.warn(`MCP session server close failed: ${errorMessage(err)}`));
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  /** Number of live sessions (for diagnostics/tests). */
  get size(): number {
    return this.sessions.size;
  }

  /** Close every live session — call on server shutdown. */
  async closeAll(): Promise<void> {
    const open = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(
      open.map((s) =>
        s.transport.close().catch((err: unknown) => console.warn(`MCP session close failed: ${errorMessage(err)}`)),
      ),
    );
  }
}
