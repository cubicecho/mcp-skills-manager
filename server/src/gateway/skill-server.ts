import type { Skill, SkillFileRead, SkillToolMode } from '@mcp-skills/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { errorMessage } from '../errors.ts';
import { bundledFiles, skillToolNames } from '../skills/skill-view.ts';
import { SERVER_VERSION } from '../version.ts';
import type { AuthoringDeps, AuthoringTool } from './authoring-tools.ts';
import { buildAuthoringTools, issueSummary } from './authoring-tools.ts';
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
  encodeCursor,
  fileResourceUri,
  parseResourceUri,
  RESOURCE_PAGE_SIZE,
  resourceNotFound,
  SKILL_FILE_URI_TEMPLATE,
  SKILL_URI_TEMPLATE,
  skillResourceUri,
} from './resource-uri.ts';
import type { SkillPromptRef } from './skill-prompts.ts';
import { fillPrompt, listPromptRefs, missingArguments, parsePrompt } from './skill-prompts.ts';
import { renderIndex, renderSkill, skillTitle } from './skill-render.ts';
import { searchSkills } from './skill-search.ts';

/**
 * Builds the capabilities the server advertises.
 *
 * @param liveUpdates - Whether the transport is long-lived, and so can push `listChanged` and take `subscribe`.
 * @param servesPrompts - Whether the endpoint can read skill files; a prompt is one, so none are served without.
 * @returns The options object the `Server` constructor takes.
 *
 * @remarks
 * The stateless HTTP path leaves live updates off: it cannot push, and re-lists fresh on every request anyway.
 */
function skillCapabilities(liveUpdates: boolean, servesPrompts: boolean) {
  return {
    capabilities: {
      tools: {},
      resources: liveUpdates ? { listChanged: true, subscribe: true } : {},
      ...(servesPrompts ? { prompts: liveUpdates ? { listChanged: true } : {} } : {}),
      // Argument autocompletion for the resource templates below (skill names, file paths).
      completions: {},
    },
  };
}

/**
 * Wraps text as a `tools/call` result.
 *
 * @param text - The text to hand back to the agent.
 * @returns A tool result holding one text block.
 */
function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

/** Max completion values the spec allows a single response to carry. */
const COMPLETION_LIMIT = 100;

/**
 * Shapes the candidates a partial value is a prefix of into a `completion/complete` result.
 *
 * @param candidates - Every value the argument could take.
 * @param value - What the user has typed so far; compared ignoring case.
 * @returns The first `COMPLETION_LIMIT` matches, the true `total`, and `hasMore` when there are more than returned.
 */
function completeFrom(candidates: string[], value: string) {
  const prefix = value.toLowerCase();
  const matches = candidates.filter((c) => c.toLowerCase().startsWith(prefix));
  const values = matches.slice(0, COMPLETION_LIMIT);
  return { completion: { values, total: matches.length, hasMore: matches.length > values.length } };
}

/** What a skill server needs from the endpoint that builds it. */
export interface SkillServerDeps {
  /** Returns the served skills; called fresh per request, so config edits take effect without a restart. */
  getSkills: () => Skill[];
  /** Endpoint label used in the MCP server info (e.g. `all` or a workspace slug). */
  label: string;
  /**
   * Exposes the skill-authoring tools on this endpoint too; left out, the server is strictly read-only.
   *
   * @remarks
   * Which of them are served is decided at call time, from the store's `authoringEnabled` and
   * `disabledAuthoringTools` settings.
   */
  authoring?: AuthoringDeps;
  /**
   * Returns how skills are advertised as tools; left out, each skill gets its own tool.
   *
   * @remarks
   * It is called fresh per request, so a settings change takes effect without a restart.
   */
  getSkillToolMode?: () => SkillToolMode;
  /**
   * Reads a bundled supporting file's contents; left out, the server exposes neither file resources nor prompts.
   *
   * @remarks
   * With it, a skill's files are `skill://<name>/<path>` resources whether or not the authoring tools are enabled,
   * and its `prompts/*.md` files are served as MCP prompts.
   */
  readSupportingFile?: (skillName: string, relPath: string) => Promise<SkillFileRead>;
  /**
   * Called with a skill's name whenever its body is loaded through a tool (its own or `load_skill`), for usage
   * analytics; it must not throw.
   */
  onSkillLoaded?: (skillName: string) => void;
  /**
   * Registers a listener fired whenever the served skill set changes on disk, and returns its unsubscribe function.
   *
   * @remarks
   * When present, the server advertises `listChanged` for resources and prompts plus resource `subscribe`, and
   * pushes notifications. Wire it only on a long-lived transport: the stateless HTTP path cannot push.
   */
  onSkillsChanged?: (listener: () => void) => () => void;
}

/**
 * Builds an MCP server that serves a set of skills.
 *
 * @param deps - The endpoint's skill source, label and optional capabilities.
 * @returns The configured server, not yet connected to a transport.
 *
 * @remarks
 * Each skill is reachable both through a tool (its own, or `load_skill` in loader mode) and as a
 * `skill://<name>` resource, so a client using either mechanism reaches every skill. A skill's `prompts/*.md`
 * files are served as MCP prompts when the endpoint can read files.
 */
export function createSkillServer(deps: SkillServerDeps): Server {
  const liveUpdates = Boolean(deps.onSkillsChanged);
  const servesPrompts = deps.readSupportingFile !== undefined;
  const server = new Server(
    { name: `mcp-skills/${deps.label}`, version: SERVER_VERSION },
    skillCapabilities(liveUpdates, servesPrompts),
  );

  registerToolHandlers(server, deps);
  registerResourceHandlers(server, deps);
  if (deps.readSupportingFile) {
    registerPromptHandlers(server, deps.getSkills, deps.readSupportingFile);
  }
  registerCompletionHandler(server, deps);
  if (deps.onSkillsChanged) {
    registerLiveUpdates(server, deps.onSkillsChanged, servesPrompts);
  }
  return server;
}

/**
 * Finds a skill by its exact name.
 *
 * @param skills - The skills this endpoint serves.
 * @param name - The skill name (slug) to look for.
 * @returns The matching skill, or `undefined` when none is served under that name.
 */
function findByName(skills: Skill[], name: string): Skill | undefined {
  return skills.find((s) => s.name === name);
}

/** What `search_skills` takes: both are optional, and neither given lists everything. */
const searchArgsSchema = z.strictObject({ query: z.string().default(''), tags: z.array(z.string()).default([]) });

/** What `load_skill` takes. */
const loadArgsSchema = z.strictObject({ name: z.string() });

/**
 * Checks a meta-tool's arguments, so a wrong-typed one is refused rather than read as absent.
 *
 * @typeParam T - The parsed arguments.
 * @param toolName - The tool being called, named in the error.
 * @param schema - What the tool takes.
 * @param args - What the caller sent.
 * @returns The arguments, with defaults filled in.
 * @throws McpError naming each argument that does not fit.
 */
function parseToolArgs<T>(toolName: string, schema: z.ZodType<T>, args: unknown): T {
  const result = schema.safeParse(args ?? {});
  if (result.success === false) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for ${toolName}: ${issueSummary(result.error)}`);
  }
  return result.data;
}

/**
 * Registers `tools/list` and `tools/call`: the meta-tools, the authoring tools, and the skills themselves.
 *
 * @param server - The MCP server to register the handlers on.
 * @param deps - The endpoint's skill source and optional authoring access.
 */
function registerToolHandlers(server: Server, deps: SkillServerDeps): void {
  const findByToolName = (name: string): Skill | undefined => {
    const skills = deps.getSkills();
    const toolNames = skillToolNames(skills);
    return skills.find((skill) => toolNames.get(skill.name) === name);
  };

  // Authoring tools are built once (closures over the store); which of them are actually served is
  // decided live per request, from `authoringEnabled` and `disabledAuthoringTools`.
  const authoringTools: AuthoringTool[] = deps.authoring ? buildAuthoringTools(deps.authoring) : [];
  const activeAuthoringTools = (): AuthoringTool[] => {
    const store = deps.authoring?.store;
    const isAuthoringOn = store?.isAuthoringEnabled() === true;
    if (!store || isAuthoringOn === false) {
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
    const toolNames = skillToolNames(skills);
    const skillTools = skills
      .map((skill) => ({ skill, name: toolNames.get(skill.name) ?? skill.name }))
      .filter(({ name }) => reserved.has(name) === false)
      .map(({ skill, name }) => ({
        name,
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
      const skills = deps.getSkills();
      return textResult(renderIndex(skills, skillToolMode(), skillToolNames(skills)));
    }
    if (req.params.name === SEARCH_TOOL_NAME) {
      const { query, tags } = parseToolArgs(SEARCH_TOOL_NAME, searchArgsSchema, req.params.arguments);
      const skills = deps.getSkills();
      return textResult(renderIndex(searchSkills(skills, query, tags), skillToolMode(), skillToolNames(skills)));
    }
    if (skillToolMode() === 'loader' && req.params.name === LOAD_TOOL_NAME) {
      const { name: wanted } = parseToolArgs(LOAD_TOOL_NAME, loadArgsSchema, req.params.arguments);
      // Resolved by the skill's real name only, the field `list_skills` advertises: a sanitized tool name
      // would be ambiguous (`commit.messages` and `commit_messages` collide).
      const skill = findByName(deps.getSkills(), wanted);
      if (!skill) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown skill "${wanted}": call ${INDEX_TOOL_NAME} for the names served here`,
        );
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
    // Loader mode advertises no per-skill tools, so it answers none.
    const skill = skillToolMode() === 'loader' ? undefined : findByToolName(req.params.name);
    if (!skill) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown skill tool "${req.params.name}"`);
    }
    return loadSkill(skill);
  });
}

/**
 * Registers `resources/list`, `resources/read` and `resources/templates/list` for skills and their bundled files.
 *
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
    const { skill: skillName, path: relPath } = parseResourceUri(uri);

    if (relPath === undefined) {
      const skill = skillName ? findByName(deps.getSkills(), skillName) : undefined;
      if (!skill) {
        throw resourceNotFound(uri);
      }
      return { contents: [{ uri, mimeType: 'text/markdown', text: renderSkill(skill) }] };
    }

    // Bundled supporting file.
    // Guard visibility: only skills served by *this* endpoint (root/workspace) are reachable.
    const readSupportingFile = deps.readSupportingFile;
    const canReadFile = findByName(deps.getSkills(), skillName) !== undefined && readSupportingFile !== undefined;
    if (canReadFile === false) {
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

/** A prompt file as read: the prompt, or why it cannot be served. */
type ReadPrompt = { prompt: ReturnType<typeof parsePrompt> } | { unreadable: string };

/**
 * Registers `prompts/list` and `prompts/get`: every `prompts/<name>.md` of a served skill, as the prompt `<name>`.
 *
 * @param server - The MCP server to register the handlers on.
 * @param getSkills - Returns the skills this endpoint serves, so a prompt is only as visible as its skill.
 * @param readSupportingFile - Reads a prompt file's contents.
 */
function registerPromptHandlers(
  server: Server,
  getSkills: SkillServerDeps['getSkills'],
  readSupportingFile: NonNullable<SkillServerDeps['readSupportingFile']>,
): void {
  // A file that cannot be served as a prompt, unreadable or not text, comes back as the reason why.
  const readPrompt = async (ref: SkillPromptRef): Promise<ReadPrompt> => {
    try {
      const file = await readSupportingFile(ref.skillName, ref.path);
      return file.binary ? { unreadable: 'not a text file' } : { prompt: parsePrompt(file.content) };
    } catch (err) {
      return { unreadable: errorMessage(err) };
    }
  };

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const refs = listPromptRefs(getSkills());
    const parsed = await Promise.all(refs.map(readPrompt));
    const prompts = [];
    for (const [index, ref] of refs.entries()) {
      const read = parsed[index];
      if (read === undefined) {
        continue;
      }
      if ('unreadable' in read) {
        console.warn(`Skipping prompt "${ref.name}" of skill "${ref.skillName}": ${read.unreadable}`);
        continue;
      }
      prompts.push({
        name: ref.name,
        description: read.prompt.description ?? `Prompt from the "${ref.skillName}" skill.`,
        arguments: read.prompt.arguments,
      });
    }
    return { prompts };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const { name } = req.params;
    const ref = listPromptRefs(getSkills()).find((candidate) => candidate.name === name);
    if (!ref) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt "${name}"`);
    }
    const read = await readPrompt(ref);
    if ('unreadable' in read) {
      throw new McpError(ErrorCode.InvalidParams, `Cannot read prompt "${name}": ${read.unreadable}`);
    }
    const { prompt } = read;
    const given = req.params.arguments ?? {};
    const missing = missingArguments(prompt.arguments, given);
    if (missing.length > 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Prompt "${name}" is missing required argument: ${missing.join(', ')}`,
      );
    }
    return {
      description: prompt.description,
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: fillPrompt(prompt.body, prompt.arguments, given) },
        },
      ],
    };
  });
}

/**
 * Registers argument autocompletion for the resource templates: skill names for `{name}`, and for `{+path}`
 * the bundled-file paths of the skill already chosen as `name`.
 *
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
 * Sends a notification without waiting on it; a client that has gone only costs a warning.
 *
 * @param method - The notification's method, for the log line.
 * @param sent - The send in flight.
 */
function notifyQuietly(method: string, sent: Promise<void>): void {
  sent.catch((err: unknown) => {
    console.warn(`${method} notify failed: ${errorMessage(err)}`);
  });
}

/**
 * Registers resource subscriptions, and pushes notifications when the served skill set changes on disk.
 *
 * @param server - The MCP server to register the handlers on.
 * @param onSkillsChanged - Registers a change listener and returns its unsubscribe function.
 * @param servesPrompts - Whether the server advertises prompts, and so may announce that their list changed.
 *
 * @remarks
 * It is only for a long-lived transport, and unsubscribes from the changes when the server closes.
 */
function registerLiveUpdates(
  server: Server,
  onSkillsChanged: NonNullable<SkillServerDeps['onSkillsChanged']>,
  servesPrompts: boolean,
): void {
  const subscriptions = new Set<string>();

  server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    subscriptions.add(req.params.uri);
    return {};
  });
  server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    subscriptions.delete(req.params.uri);
    return {};
  });

  // A disk change may touch any skill, so say the list moved and nudge every subscribed URI. Over-notifying
  // beats diffing: the client re-reads, and the content is authoritative either way.
  const unsubscribe = onSkillsChanged(() => {
    notifyQuietly('resources/list_changed', server.sendResourceListChanged());
    if (servesPrompts) {
      notifyQuietly('prompts/list_changed', server.sendPromptListChanged());
    }
    for (const uri of subscriptions) {
      notifyQuietly('resources/updated', server.sendResourceUpdated({ uri }));
    }
  });

  const prevOnClose = server.onclose;
  server.onclose = () => {
    unsubscribe();
    prevOnClose?.();
  };
}
