import type { Skill, SkillFileRead, SkillToolMode } from '@mcp-skills/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { errorMessage } from '../errors.ts';
import { bundledFiles, skillToolName } from '../skills/skill-view.ts';
import { SERVER_VERSION } from '../version.ts';
import type { AuthoringDeps, AuthoringTool } from './authoring-tools.ts';
import { buildAuthoringTools } from './authoring-tools.ts';
import { fileMimeType } from './mime.ts';
import {
  decodeCursor,
  decodeResourcePart,
  encodeCursor,
  fileResourceUri,
  RESOURCE_PAGE_SIZE,
  RESOURCE_SCHEME,
  resourceNotFound,
  SKILL_FILE_URI_TEMPLATE,
  SKILL_URI_TEMPLATE,
  skillResourceUri,
} from './resource-uri.ts';
import { renderIndex, renderSkill, skillTitle } from './skill-render.ts';
import { searchSkills } from './skill-search.ts';

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
      // Argument autocompletion for the resource templates below (skill names, file paths).
      completions: {},
    },
  };
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

/** Max completion values the spec allows a single response to carry. */
const COMPLETION_LIMIT = 100;

/**
 * Prefix-match `candidates` (case-insensitively) against a partial `value` and
 * shape them into a `completion/complete` result: the first `COMPLETION_LIMIT`
 * matches, the true `total`, and `hasMore` when the total exceeds what we return.
 */
function completeFrom(candidates: string[], value: string) {
  const prefix = value.toLowerCase();
  const matches = candidates.filter((c) => c.toLowerCase().startsWith(prefix));
  const values = matches.slice(0, COMPLETION_LIMIT);
  return { completion: { values, total: matches.length, hasMore: matches.length > values.length } };
}

export interface SkillServerDeps {
  /** Resolved fresh per request so config edits take effect without a restart. */
  getSkills: () => Skill[];
  /** Endpoint label used in the MCP server info (e.g. "all skills" or a workspace slug). */
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

  const findByToolName = (name: string): Skill | undefined =>
    deps.getSkills().find((s) => skillToolName(s.name) === name);
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
      .filter((skill) => !reserved.has(skillToolName(skill.name)))
      .map((skill) => ({
        name: skillToolName(skill.name),
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
        for (const file of bundledFiles(skill)) {
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
    // Guard visibility: only skills served by *this* endpoint (root/workspace) are reachable.
    const readSupportingFile = deps.readSupportingFile;
    const canReadFile = findByName(skillName) !== undefined && readSupportingFile !== undefined;
    if (!canReadFile) {
      throw resourceNotFound(uri);
    }
    let file: SkillFileRead;
    try {
      file = await readSupportingFile(skillName, relPath);
    } catch (err) {
      throw new McpError(ErrorCode.InvalidParams, `Cannot read resource "${uri}": ${errorMessage(err)}`);
    }
    const mimeType = fileMimeType(relPath);
    return {
      contents: [file.binary ? { uri, mimeType, blob: file.content } : { uri, mimeType, text: file.content }],
    };
  });

  // Resource templates: advertise the URI shapes a client can construct itself
  // (`skill://{name}` and, when file resources are served, `skill://{name}/{+path}`).
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    const templates: Array<{
      uriTemplate: string;
      name: string;
      title: string;
      description: string;
      mimeType?: string;
    }> = [
      {
        uriTemplate: SKILL_URI_TEMPLATE,
        name: 'skill',
        title: 'Skill document',
        description: "A skill's Markdown document, addressed by its slug name.",
        mimeType: 'text/markdown',
      },
    ];
    if (deps.readSupportingFile) {
      // Bundled files vary in type, so this template carries no fixed mimeType.
      templates.push({
        uriTemplate: SKILL_FILE_URI_TEMPLATE,
        name: 'skill-file',
        title: 'Skill supporting file',
        description: 'A bundled supporting file within a directory-format skill.',
      });
    }
    return { resourceTemplates: templates };
  });

  // Argument autocompletion for those templates: skill names for `{name}`, and a
  // skill's bundled-file paths for `{+path}` (scoped by the `name` already chosen).
  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    const { ref, argument, context } = req.params;
    const empty = { completion: { values: [], total: 0, hasMore: false } };
    if (ref.type !== 'ref/resource') {
      return empty;
    }
    const skills = deps.getSkills();
    if (ref.uri === SKILL_URI_TEMPLATE && argument.name === 'name') {
      return completeFrom(
        skills.map((s) => s.name),
        argument.value,
      );
    }
    if (ref.uri === SKILL_FILE_URI_TEMPLATE) {
      if (argument.name === 'name') {
        return completeFrom(
          skills.map((s) => s.name),
          argument.value,
        );
      }
      if (argument.name === 'path') {
        // Only files of the already-chosen skill are valid completions for its path.
        const chosen = context?.arguments?.name;
        const skill = chosen ? skills.find((s) => s.name === chosen) : undefined;
        const paths = skill ? bundledFiles(skill).map((f) => f.path) : [];
        return completeFrom(paths, argument.value);
      }
    }
    return empty;
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
