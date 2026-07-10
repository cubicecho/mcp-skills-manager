import type { Skill, SkillFileRead, SkillToolMode } from '@mcp-skills/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { errorMessage } from '../errors.ts';
import { SERVER_VERSION } from '../version.ts';
import type { AuthoringDeps, AuthoringTool } from './authoring-tools.ts';
import { buildAuthoringTools } from './authoring-tools.ts';

/**
 * Server capabilities. `liveUpdates` toggles the two resource sub-capabilities
 * that only make sense on a long-lived transport (stdio): `listChanged` (the
 * served skill set changed on disk) and `subscribe` (per-resource change
 * notifications). The stateless HTTP path leaves them off — it cannot push and
 * re-lists fresh on every request anyway.
 */
function skillCapabilities(liveUpdates: boolean) {
  return {
    capabilities: {
      tools: {},
      resources: liveUpdates ? { listChanged: true, subscribe: true } : {},
    },
  };
}

/** URI scheme under which skills are exposed as MCP resources. */
const RESOURCE_SCHEME = 'skill';

/**
 * MCP's spec-defined "resource not found" JSON-RPC error code. It is absent from
 * the SDK's `ErrorCode` enum, so we spell it out; the spec asks servers to return
 * it (with the offending URI in `data`) for unknown resources rather than the
 * generic `InvalidParams`.
 */
const RESOURCE_NOT_FOUND = -32002;

/** A spec-compliant resource-not-found error carrying the offending URI in `data`. */
function resourceNotFound(uri: string): McpError {
  return new McpError(RESOURCE_NOT_FOUND, `Unknown skill resource "${uri}"`, { uri });
}

/** The `skill://<name>` resource URI for a skill's primary document. Names are slugs, already URI-safe. */
function skillResourceUri(name: string): string {
  return `${RESOURCE_SCHEME}://${name}`;
}

/**
 * The `skill://<name>/<path>` URI for a bundled supporting file, percent-encoding
 * each path segment (but not the `/` separators) so the advertised URI round-trips
 * cleanly through the read handler's `decodeURIComponent` — filenames with spaces,
 * `%`, `#`, etc. survive intact.
 */
function fileResourceUri(name: string, relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${skillResourceUri(name)}/${encoded}`;
}

/**
 * Max resources returned per `resources/list` page. The list is rebuilt from live
 * state each call, so the cursor is a plain offset — a mutation between pages can
 * shift entries, which is acceptable under MCP's opaque-cursor semantics.
 */
const RESOURCE_PAGE_SIZE = 100;

/** Encode a list offset as an opaque pagination cursor. */
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

/** Decode a pagination cursor back to an offset; a malformed cursor is an `InvalidParams` error. */
function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const offset = Number.parseInt(decoded, 10);
  if (!Number.isInteger(offset) || offset < 0 || String(offset) !== decoded) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid pagination cursor "${cursor}"`);
  }
  return offset;
}

/**
 * Name of the meta-tool that returns the skill catalogue. A skill could in
 * theory be named `list_skills` too; the meta-tool wins (that skill stays
 * reachable as a resource and is omitted from the tool list to avoid a dupe).
 */
const INDEX_TOOL_NAME = 'list_skills';

/**
 * Name of the loader tool served in `loader` mode: a single `load_skill(name)`
 * tool that returns any skill's body, instead of one tool per skill. Keeps the
 * advertised tool count fixed regardless of how many skills exist.
 */
const LOAD_TOOL_NAME = 'load_skill';

/**
 * Name of the search meta-tool: full-text lookup over the catalogue (name,
 * description, tags, and body) so an agent can find relevant skills by intent
 * without loading every body. Returns the same metadata shape as `list_skills`.
 */
const SEARCH_TOOL_NAME = 'search_skills';

/**
 * MCP tool names are conventionally restricted to `[A-Za-z0-9_-]`, but skill
 * names may contain dots — sanitize for the tool name and keep a reverse map
 * (built per request from the live skill list) to resolve calls back.
 */
function toolName(skill: Skill): string {
  return skill.name.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Extension → MIME type for bundled supporting files. Purely extension-driven so
 * the resource *listing* and the resource *read* agree on the type (the read
 * path decides blob-vs-text from the actual `binary` flag, independent of this).
 * Returns `undefined` for unknown extensions — we omit the mimeType rather than
 * guess `text/plain` and mislabel a binary blob.
 */
const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  py: 'text/x-python',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/x-typescript',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  toml: 'application/toml',
  sh: 'application/x-sh',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

/** Best-effort MIME type for a bundled supporting file; `undefined` when the extension is unrecognized. */
function fileMimeType(relPath: string): string | undefined {
  const dot = relPath.lastIndexOf('.');
  if (dot === -1) {
    return undefined;
  }
  return MIME_BY_EXT[relPath.slice(dot + 1).toLowerCase()];
}

/**
 * `decodeURIComponent`, but a malformed percent-escape (e.g. a lone `%`) surfaces
 * as a clean `InvalidParams` MCP error instead of a raw `URIError` that would
 * escape as a transport-level exception.
 */
function decodeResourcePart(part: string, uri: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new McpError(ErrorCode.InvalidParams, `Unknown skill resource "${uri}"`);
  }
}

/** Normalize the `allowed-tools` frontmatter (a comma-separated string or a list) to a clean string array. */
function allowedTools(skill: Skill): string[] {
  const raw = skill.frontmatter['allowed-tools'];
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return parts.map((t) => t.trim()).filter((t) => t.length > 0);
}

/** The optional Agent Skills metadata (license, allowed-tools) an agent may care about, if present. */
function skillMeta(skill: Skill): { license?: string; allowedTools?: string[] } {
  const meta: { license?: string; allowedTools?: string[] } = {};
  if (typeof skill.frontmatter.license === 'string' && skill.frontmatter.license.length > 0) {
    meta.license = skill.frontmatter.license;
  }
  const tools = allowedTools(skill);
  if (tools.length > 0) {
    meta.allowedTools = tools;
  }
  return meta;
}

/** Optional human-readable display title, from frontmatter `title` when authored (never fabricated from the slug). */
function skillTitle(skill: Skill): string | undefined {
  const title = skill.frontmatter.title;
  return typeof title === 'string' && title.trim().length > 0 ? title.trim() : undefined;
}

/** The text handed to an agent when it loads a skill: the Markdown body, plus footers for metadata and bundled files. */
function renderSkill(skill: Skill): string {
  const sections = [skill.body];

  const meta = skillMeta(skill);
  const metaLines: string[] = [];
  if (meta.allowedTools) {
    metaLines.push(`- Allowed tools: ${meta.allowedTools.join(', ')}`);
  }
  if (meta.license) {
    metaLines.push(`- License: ${meta.license}`);
  }
  if (metaLines.length > 0) {
    sections.push(`---\nSkill metadata:\n${metaLines.join('\n')}`);
  }

  const files = skill.files.filter((f) => f.type === 'file');
  if (files.length > 0) {
    const list = files.map((f) => `- ${f.path} — resource \`${fileResourceUri(skill.name, f.path)}\``).join('\n');
    sections.push(
      `---\nBundled supporting files (in the skill directory \`${skill.name}/\`), readable as MCP resources:\n${list}`,
    );
  }

  // Single section ⇒ exactly `skill.body`; multiple ⇒ body + footers joined.
  return sections.join('\n\n');
}

/** One catalogue entry: the metadata an agent needs to decide whether to load a skill (never the body). */
function indexEntry(skill: Skill) {
  return {
    name: skill.name,
    tool: toolName(skill),
    description: skill.description,
    format: skill.format,
    files: skill.files.filter((f) => f.type === 'file').map((f) => f.path),
    updatedAt: skill.updatedAt,
    ...(skill.tags.length > 0 ? { tags: skill.tags } : {}),
    ...skillMeta(skill),
  };
}

/** The JSON catalogue returned by the index tool: every skill's metadata, no bodies. */
function renderIndex(skills: Skill[]): string {
  return JSON.stringify({ count: skills.length, skills: skills.map(indexEntry) }, null, 2);
}

/**
 * Rank skills against a free-text query and/or a tag filter. `query` is matched
 * case-insensitively against the name, description, tags, and body (each search
 * term must appear somewhere); `tags` narrows to skills carrying at least one of
 * the requested tags. With neither, every skill matches (mirrors `list_skills`).
 * Matches keep the caller's order — the metadata each carries lets the agent rank.
 */
function searchSkills(skills: Skill[], query: string, tags: string[]): Skill[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const wantTags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  return skills.filter((skill) => {
    if (wantTags.length > 0) {
      const skillTags = skill.tags.map((t) => t.toLowerCase());
      if (!wantTags.some((t) => skillTags.includes(t))) {
        return false;
      }
    }
    if (terms.length > 0) {
      const haystack = `${skill.name}\n${skill.description}\n${skill.tags.join(' ')}\n${skill.body}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) {
        return false;
      }
    }
    return true;
  });
}

export interface SkillServerDeps {
  /** Resolved fresh per request so config edits take effect without a restart. */
  getSkills: () => Skill[];
  /** Endpoint label used in the MCP server info (e.g. "all skills" or a profile slug). */
  label: string;
  /**
   * When set, this endpoint also exposes skill-authoring tools (create/update/…),
   * gated at call time on the store's `authoringEnabled` setting. Omit for a
   * strictly read-only server.
   */
  authoring?: AuthoringDeps;
  /**
   * How skills are advertised as tools, resolved fresh per request so a
   * settings change takes effect without a restart. Omit to default to
   * `per-skill` (one tool per skill).
   */
  getSkillToolMode?: () => SkillToolMode;
  /**
   * Read a bundled supporting file's contents, so `dir`-skill files can be
   * exposed as `skill://<name>/<path>` resources independent of whether the
   * authoring tools are enabled. Omit to not expose file resources at all.
   */
  readSupportingFile?: (skillName: string, relPath: string) => Promise<SkillFileRead>;
  /**
   * Called with a skill's name whenever its body is loaded over MCP (a per-skill
   * tool or `load_skill`), for usage analytics. Best-effort — must not throw.
   */
  onSkillLoaded?: (skillName: string) => void;
  /**
   * Register a listener fired whenever the served skill set changes on disk, and
   * return an unsubscribe fn (called when the server closes). When present, the
   * server advertises `resources.listChanged` + `subscribe` and pushes
   * notifications. Only wire this on a long-lived transport (stdio) — the
   * stateless HTTP path cannot push and must omit it.
   */
  onSkillsChanged?: (listener: () => void) => () => void;
}

/**
 * Build an MCP Server that serves a set of skills. Each skill is exposed BOTH
 * as a tool (calling it returns the skill's Markdown so an agent can load it on
 * demand) and as a resource (`skill://<name>`), so clients using either
 * mechanism can reach every skill.
 */
export function createSkillServer(deps: SkillServerDeps): Server {
  const liveUpdates = Boolean(deps.onSkillsChanged);
  const server = new Server(
    { name: `mcp-skills/${deps.label}`, version: SERVER_VERSION },
    skillCapabilities(liveUpdates),
  );

  const findByToolName = (name: string): Skill | undefined => deps.getSkills().find((s) => toolName(s) === name);
  const findByName = (name: string): Skill | undefined => deps.getSkills().find((s) => s.name === name);

  // Authoring tools are built once (closures over the store); whether they are
  // actually served is decided live per request via `authoringEnabled`.
  const authoringTools: AuthoringTool[] = deps.authoring ? buildAuthoringTools(deps.authoring) : [];
  const authoringEnabled = (): boolean => Boolean(deps.authoring?.store.isAuthoringEnabled());
  const activeAuthoringTools = (): AuthoringTool[] => (authoringEnabled() ? authoringTools : []);
  const skillToolMode = (): SkillToolMode => deps.getSkillToolMode?.() ?? 'per-skill';
  // Tool names that must never be shadowed by a same-named skill: the meta-tool,
  // any active authoring tools, and (in loader mode) the loader tool.
  const reservedNames = (): Set<string> => {
    const names = new Set<string>([
      INDEX_TOOL_NAME,
      SEARCH_TOOL_NAME,
      ...activeAuthoringTools().map((t) => t.definition.name),
    ]);
    if (skillToolMode() === 'loader') {
      names.add(LOAD_TOOL_NAME);
    }
    return names;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const skills = deps.getSkills();
    const indexToolFor = (mode: SkillToolMode) => ({
      name: INDEX_TOOL_NAME,
      description:
        'List every skill available from this endpoint with its name, description, format, and supporting ' +
        'files — without loading any skill bodies. Call this first to decide which skill(s) to load, then ' +
        (mode === 'loader'
          ? 'call `load_skill` with the `name` of each entry to fetch that skill’s full contents.'
          : "call the tool named in each entry's `tool` field to fetch that skill's full contents."),
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    });
    const searchTool = {
      name: SEARCH_TOOL_NAME,
      description:
        'Search this endpoint’s skills by intent and return the matching catalogue entries (metadata only, no ' +
        'bodies). Provide a free-text `query` (matched against each skill’s name, description, tags, and body) ' +
        'and/or a `tags` filter. Use this instead of `list_skills` when you know roughly what you need but not ' +
        'the exact skill name; then load a match by its `tool`/`name` as usual.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search; every whitespace-separated term must match.' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only skills carrying at least one of these tags.',
          },
        },
        additionalProperties: false,
      },
    };
    const authoring = activeAuthoringTools().map((t) => t.definition);
    const mode = skillToolMode();

    if (mode === 'loader') {
      // Single loader tool: fixed footprint regardless of catalogue size.
      const loadTool = {
        name: LOAD_TOOL_NAME,
        description:
          'Load one skill by name and return its full Markdown contents. Pass the `name` of a skill from ' +
          '`list_skills`. Use this instead of a per-skill tool — the catalogue is advertised by `list_skills`.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The skill name (slug) to load, as listed by list_skills.' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      };
      return { tools: [indexToolFor(mode), searchTool, loadTool, ...authoring] };
    }

    // per-skill mode: one no-arg tool per skill.
    const reserved = reservedNames();
    const skillTools = skills
      .filter((skill) => !reserved.has(toolName(skill)))
      .map((skill) => ({
        name: toolName(skill),
        description: skill.description || `Load the "${skill.name}" skill.`,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }));
    return { tools: [indexToolFor(mode), searchTool, ...authoring, ...skillTools] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === INDEX_TOOL_NAME) {
      return { content: [{ type: 'text', text: renderIndex(deps.getSkills()) }] };
    }
    if (req.params.name === SEARCH_TOOL_NAME) {
      const args = req.params.arguments ?? {};
      const query = typeof args.query === 'string' ? args.query : '';
      const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : [];
      return { content: [{ type: 'text', text: renderIndex(searchSkills(deps.getSkills(), query, tags)) }] };
    }
    if (skillToolMode() === 'loader' && req.params.name === LOAD_TOOL_NAME) {
      const raw = req.params.arguments?.name;
      const wanted = typeof raw === 'string' ? raw : '';
      // Resolve by the skill's real name only — the exact field `list_skills`
      // advertises. A sanitized-tool-name fallback would be ambiguous (distinct
      // slugs like `commit.messages` and `commit_messages` collide).
      const skill = findByName(wanted);
      if (!skill) {
        throw new McpError(ErrorCode.InvalidParams, `Unknown skill "${wanted}"`);
      }
      deps.onSkillLoaded?.(skill.name);
      return { content: [{ type: 'text', text: renderSkill(skill) }] };
    }
    const authoringTool = activeAuthoringTools().find((t) => t.definition.name === req.params.name);
    if (authoringTool) {
      try {
        const text = await authoringTool.run(req.params.arguments ?? {});
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        // Surface authoring failures as a readable tool error, not a transport-level exception,
        // so the agent can see what went wrong and retry.
        return { content: [{ type: 'text', text: errorMessage(err) }], isError: true };
      }
    }
    const skill = findByToolName(req.params.name);
    if (!skill) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown skill tool "${req.params.name}"`);
    }
    deps.onSkillLoaded?.(skill.name);
    return { content: [{ type: 'text', text: renderSkill(skill) }] };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (req) => {
    const resources = [];
    for (const skill of deps.getSkills()) {
      resources.push({
        uri: skillResourceUri(skill.name),
        name: skill.name,
        // Optional display name, only when the author set a frontmatter `title`.
        title: skillTitle(skill),
        description: skill.description || undefined,
        mimeType: 'text/markdown',
        // Skills are context authored for the model; `lastModified` lets clients sort by recency.
        annotations: { audience: ['assistant'], lastModified: skill.updatedAt },
      });
      // Expose each bundled supporting file as its own resource — but only when
      // we can actually read file contents, so we never advertise a dead URI.
      if (deps.readSupportingFile) {
        for (const file of skill.files.filter((f) => f.type === 'file')) {
          resources.push({
            uri: fileResourceUri(skill.name, file.path),
            name: `${skill.name}/${file.path}`,
            description: `Supporting file for the "${skill.name}" skill.`,
            // Omit rather than guess when the extension is unknown — the read
            // path stays consistent by computing mimeType the same way.
            mimeType: fileMimeType(file.path),
            // Byte size is known from disk metadata, so clients can gauge a file before reading it.
            size: file.size,
            annotations: { audience: ['assistant'] },
          });
        }
      }
    }
    // Paginate over the fully-built list: slice at the cursor offset and hand back
    // a nextCursor only while more remain.
    const offset = decodeCursor(req.params?.cursor);
    const page = resources.slice(offset, offset + RESOURCE_PAGE_SIZE);
    const nextOffset = offset + RESOURCE_PAGE_SIZE;
    const nextCursor = nextOffset < resources.length ? encodeCursor(nextOffset) : undefined;
    return { resources: page, ...(nextCursor ? { nextCursor } : {}) };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { uri } = req.params;
    const prefix = `${RESOURCE_SCHEME}://`;
    if (!uri.startsWith(prefix)) {
      throw resourceNotFound(uri);
    }
    // Drop any URI query/fragment before parsing the path — a raw `?`/`#`
    // delimits them (a literal `?`/`#` in a filename would be percent-encoded).
    const rest = uri.slice(prefix.length).replace(/[?#].*$/, '');
    // Skill names never contain "/", so the first slash cleanly separates the
    // skill name from a bundled-file path: skill://<name> vs skill://<name>/<path>.
    const slash = rest.indexOf('/');

    if (slash === -1) {
      const name = decodeResourcePart(rest, uri);
      const skill = name ? findByName(name) : undefined;
      if (!skill) {
        throw resourceNotFound(uri);
      }
      return { contents: [{ uri, mimeType: 'text/markdown', text: renderSkill(skill) }] };
    }

    // Bundled supporting file.
    const skillName = decodeResourcePart(rest.slice(0, slash), uri);
    const relPath = decodeResourcePart(rest.slice(slash + 1), uri);
    // Guard visibility: only skills served by *this* endpoint (root/profile) are reachable.
    if (!findByName(skillName) || !deps.readSupportingFile) {
      throw resourceNotFound(uri);
    }
    let file: SkillFileRead;
    try {
      file = await deps.readSupportingFile(skillName, relPath);
    } catch (err) {
      throw new McpError(ErrorCode.InvalidParams, `Cannot read resource "${uri}": ${errorMessage(err)}`);
    }
    const mimeType = fileMimeType(relPath);
    return {
      contents: [file.binary ? { uri, mimeType, blob: file.content } : { uri, mimeType, text: file.content }],
    };
  });

  // Live updates (stdio only): advertise `listChanged` + `subscribe`, and push
  // notifications when the served skill set changes on disk.
  if (deps.onSkillsChanged) {
    const subscriptions = new Set<string>();

    server.setRequestHandler(SubscribeRequestSchema, async (req) => {
      subscriptions.add(req.params.uri);
      return {};
    });
    server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
      subscriptions.delete(req.params.uri);
      return {};
    });

    // A disk change may add/remove/edit any skill, so tell clients the list moved
    // and nudge every subscribed URI to re-read. We over-notify rather than diff —
    // the client simply re-reads and the content is authoritative either way.
    const unsubscribe = deps.onSkillsChanged(() => {
      server.sendResourceListChanged().catch((err: unknown) => {
        console.warn(`resources/list_changed notify failed: ${errorMessage(err)}`);
      });
      for (const uri of subscriptions) {
        server.sendResourceUpdated({ uri }).catch((err: unknown) => {
          console.warn(`resources/updated notify failed: ${errorMessage(err)}`);
        });
      }
    });

    const prevOnClose = server.onclose;
    server.onclose = () => {
      unsubscribe();
      prevOnClose?.();
    };
  }

  return server;
}
