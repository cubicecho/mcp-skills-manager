import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@mcp-skills/shared';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { sendError } from '../errors.ts';
import { closeQuietly } from './close-quietly.ts';

/** One live stateful session: its skill server and the transport that carries it. */
interface Session {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

/**
 * Holds the long-lived MCP sessions of the stateful Streamable-HTTP transport, which can push notifications over SSE.
 *
 * @remarks
 * Each session owns a `Server` and a transport, keyed by the `Mcp-Session-Id` the transport mints on initialize.
 * A session is reclaimed when its client closes the standalone SSE stream or sends a DELETE; one whose client
 * never opened that stream and then vanished lingers until shutdown. It runs only when
 * `settings.httpLiveUpdates` is on.
 */
export class McpSessionManager {
  /** Live sessions by `Mcp-Session-Id`. */
  private readonly sessions = new Map<string, Session>();

  /**
   * Routes one HTTP request through a persistent session.
   *
   * @param req - The request; its `Mcp-Session-Id` header picks the session.
   * @param res - The response; answered 404 for an unknown session id, 400 for a non-initialize request without one.
   * @param buildServer - Builds the skill server of a new session; called only when one opens.
   *
   * @remarks
   * A known session id reuses that session's transport. An initialize request without an id opens a new session.
   */
  async handle(req: Request, res: Response, buildServer: () => Server): Promise<void> {
    const header = req.headers['mcp-session-id'];
    const id = typeof header === 'string' ? header : undefined;

    if (id) {
      const existing = this.sessions.get(id);
      if (!existing) {
        sendError(res, HttpStatus.NotFound, `Unknown MCP session "${id}"`);
        return;
      }
      // The standalone GET is the session's SSE push channel, and its `close` is the only sign the client has
      // gone, so reap there. Never on POST/DELETE: their JSON responses close at once.
      if (req.method === 'GET') {
        res.on('close', () => {
          void closeQuietly(existing.transport, 'MCP session');
        });
      }
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    if (isInitializeRequest(req.body) === false) {
      sendError(
        res,
        HttpStatus.BadRequest,
        'Missing Mcp-Session-Id header (send an initialize request to open a session)',
      );
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
    // Set BEFORE connect() so the SDK chains it ahead of its own teardown, which fires the skill server's
    // onclose. Calling server.close() here would re-enter transport.close() from inside its own onclose.
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

  /** Closes every live session; called on server shutdown. */
  async closeAll(): Promise<void> {
    const open = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(open.map((s) => closeQuietly(s.transport, 'MCP session')));
  }
}
