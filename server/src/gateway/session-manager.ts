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
 * transport mints on initialize. A session is reclaimed when the client closes its
 * standalone SSE stream (an ungraceful disconnect or `client.close()`, which aborts
 * the stream without a DELETE) or sends an explicit DELETE — either way the transport
 * closes, which unsubscribes the session's store `change` listener. (A session whose
 * client never opens the SSE stream and then vanishes lingers until server shutdown,
 * but that stream is the whole point of stateful mode, so real clients always hold it.
 * The stateless path in `routes.ts` stays the default; this only runs when
 * `settings.httpLiveUpdates` is on.)
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
      // The standalone GET request is the session's long-lived SSE push channel.
      // When the client drops it — an explicit `client.close()` aborts the stream
      // WITHOUT sending a DELETE, as does any ungraceful disconnect — Express fires
      // `close` on that response. That is our only reliable "client is gone" signal,
      // so we close the transport to reclaim the session (and unsubscribe its store
      // `change` listener). POST/DELETE responses close immediately in JSON mode, so
      // we must reap solely on the GET stream, never on those.
      if (req.method === 'GET') {
        res.on('close', () => {
          existing.transport
            .close()
            .catch((err: unknown) => console.warn(`MCP session close failed: ${errorMessage(err)}`));
        });
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
    // On disconnect / DELETE, drop the session from the map. We set this BEFORE
    // connect() so the SDK chains it ahead of its own teardown — the skill
    // server's own onclose hook (which unsubscribes the store change listener)
    // then fires via that chain, so we must NOT call server.close() here (it
    // would re-enter transport.close() from inside its own onclose).
    transport.onclose = () => {
      const closedId = transport.sessionId;
      if (closedId) {
        this.sessions.delete(closedId);
      }
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
