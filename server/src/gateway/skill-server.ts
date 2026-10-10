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
import {
  INDEX_TOOL_NAME,
  indexToolDefinition,
  LOAD_TOOL_DEFINITION,
  LOAD_TOOL_NAME,
  NO_ARGS_SCHEMA,
  SEARCH_TOOL_DEFINITION,
  SEARCH_TOOL_NAME,
} from './meta-tools.ts';
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
 * Wrap text as a `tools/call` result.
 * @param text - The text to hand back to the agent.
 * @returns A tool result holding one text block.
 */
function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

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
   * gated at call time on the store's `authoringEnabled` and `disabledAuthoringTools`
   * settings. Omit for a strictly read-only server.
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
 * @param deps - The endpoint's skill source, label and optional capabilities.
 * @returns The configured server, not yet connected to a transport.
 */
export function createSkillServer(deps: SkillServerDeps): Server {
  const liveUpdates = Boolean(deps.onSkillsChanged);
  const server = new Server(
    { name: `mcp-skills/${deps.label}`, version: SERVER_VERSION },
    skillCapabilities(liveUpdates),
  );

  registerToolHandlers(server, deps);
  registerResourceHandlers(server, deps);
  registerCompletionHandler(server, deps);
  if (deps.onSkillsChanged) {
    registerLiveUpdates(server, deps.onSkillsChanged);
  }
  return server;
}

/**
 * Find a skill by its exact name.
 * @param skills - The skills this endpoint serves.
 * @param name - The skill name (slug) to look for.
 * @returns The matching skill, or `undefined` when none is served under that name.
 */
function findByName(skills: Skill[], name: string): Skill | undefined {
  return skills.find((s) => s.name === name);
}

/**
 * Register `tools/list` and `tools/call`: the meta-tools, the authoring tools, and the skills themselves.
 * @param server - The MCP server to register the handlers on.
 * @param deps - The endpoint's skill source and optional authoring access.
 */
function registerToolHandlers(server: Server, deps: SkillServerDeps): void {
  const findByToolName = (name: string): Skill | undefined =>
    deps.getSkills().find((s) => skillToolName(s.name) === name);

  // Authoring tools are built once (closures over the store); which of them are actually served is
  // decided live per request, from `authoringEnabled` and `disabledAuthoringTools`.
  const authoringTools: AuthoringTool[] = deps.authoring ? buildAuthoringTools(deps.authoring) : [];
  const activeAuthoringTools = (): AuthoringTool[] => {
    const store = deps.authoring?.store;
    if (!store?.isAuthoringEnabled()) {
      return [];
    }
    const disabled = store.getDisabledAuthoringTools();
    return authoringTools.filter((tool) => disabled.includes(tool.definition.name) === false);
  };
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
    const authoring = activeAuthoringTools().map((t) => t.definition);
    const mode = skillToolMode();

    if (mode === 'loader') {
      // Single loader tool: fixed footprint regardless of catalogue size.
      return { tools: [indexToolDefinition(mode), SEARCH_TOOL_DEFINITION, LOAD_TOOL_DEFINITION, ...authoring] };
    }

    // per-skill mode: one no-arg tool per skill.
    const reserved = reservedNames();
    const skillTools = skills
      .filter((skill) => !reserved.has(skillToolName(skill.name)))
      .map((skill) => ({
        name: skillToolName(skill.name),
        description: skill.description || `Load the "${skill.name}" skill.`,
        inputSchema: NO_ARGS_SCHEMA,
      }));
    return { tools: [indexToolDefinition(mode), SEARCH_TOOL_DEFINITION, ...authoring, ...skillTools] };
  });

  // Loading a skill over a tool counts as a use; a resource read does not.
  const loadSkill = (skill: Skill) => {
    deps.onSkillLoaded?.(skill.name);
    return textResult(renderSkill(skill));
  };

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === INDEX_TOOL_NAME) {
      return textResult(renderIndex(deps.getSkills(), skillToolMode()));
    }
    if (req.params.name === SEARCH_TOOL_NAME) {
      const args = req.params.arguments ?? {};
      const query = typeof args.query === 'string' ? args.query : '';
      const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : [];
      return textResult(renderIndex(searchSkills(deps.getSkills(), query, tags), skillToolMode()));
    }
    if (skillToolMode() === 'loader' && req.params.name === LOAD_TOOL_NAME) {
      const raw = req.params.arguments?.name;
      const wanted = typeof raw === 'string' ? raw : '';
      // Resolve by the skill's real name only — the exact field `list_skills`
      // advertises. A sanitized-tool-name fallback would be ambiguous (distinct
      // slugs like `commit.messages` and `commit_messages` collide).
      const skill = findByName(deps.getSkills(), wanted);
      if (!skill) {
        throw new McpError(ErrorCode.InvalidParams, `Unknown skill "${wanted}"`);
      }
      return loadSkill(skill);
    }
    const authoringTool = activeAuthoringTools().find((t) => t.definition.name === req.params.name);
    if (authoringTool) {
      try {
        return textResult(await authoringTool.run(req.params.arguments ?? {}));
      } catch (err) {
        // Surface authoring failures as a readable tool error, not a transport-level exception,
        // so the agent can see what went wrong and retry.
        return { ...textResult(errorMessage(err)), isError: true };
      }
    }
    const skill = findByToolName(req.params.name);
    if (!skill) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown skill tool "${req.params.name}"`);
    }
    return loadSkill(skill);
  });
}

/**
 * Register `resources/list`, `resources/read` and `resources/templates/list` for skills and their bundled files.
 * @param server - The MCP server to register the handlers on.
 * @param deps - The endpoint's skill source and optional file reader.
 */
function registerResourceHandlers(server: Server, deps: SkillServerDeps): void {
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
      const skill = name ? findByName(deps.getSkills(), name) : undefined;
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
    const canReadFile = findByName(deps.getSkills(), skillName) !== undefined && readSupportingFile !== undefined;
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
}

/**
 * Register argument autocompletion for the resource templates: skill names for `{name}`, and a
 * skill's bundled-file paths for `{+path}` (scoped by the `name` already chosen).
 * @param server - The MCP server to register the handler on.
 * @param deps - The endpoint's skill source.
 */
function registerCompletionHandler(server: Server, deps: SkillServerDeps): void {
  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    const { ref, argument, context } = req.params;
    const empty = { completion: { values: [], total: 0, hasMore: false } };
    if (ref.type !== 'ref/resource') {
      return empty;
    }
    const skills = deps.getSkills();
    const isFileTemplate = ref.uri === SKILL_FILE_URI_TEMPLATE;
    const takesSkillName = ref.uri === SKILL_URI_TEMPLATE || isFileTemplate;
    if (takesSkillName && argument.name === 'name') {
      return completeFrom(
        skills.map((s) => s.name),
        argument.value,
      );
    }
    if (isFileTemplate && argument.name === 'path') {
      // Only files of the already-chosen skill are valid completions for its path.
      const chosen = context?.arguments?.name;
      const skill = chosen ? findByName(skills, chosen) : undefined;
      const paths = skill ? bundledFiles(skill).map((f) => f.path) : [];
      return completeFrom(paths, argument.value);
    }
    return empty;
  });
}

/**
 * Register resource subscriptions and push notifications when the served skill set changes on
 * disk. Only for a long-lived transport (stdio).
 * @param server - The MCP server to register the handlers on.
 * @param onSkillsChanged - Registers a change listener and returns its unsubscribe function.
 */
function registerLiveUpdates(server: Server, onSkillsChanged: NonNullable<SkillServerDeps['onSkillsChanged']>): void {
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
  const unsubscribe = onSkillsChanged(() => {
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
