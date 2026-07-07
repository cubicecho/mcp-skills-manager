import type { Skill } from '@mcp-skills/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { errorMessage } from '../errors.ts';
import { SERVER_VERSION } from '../version.ts';
import type { AuthoringDeps, AuthoringTool } from './authoring-tools.ts';
import { buildAuthoringTools } from './authoring-tools.ts';

const SKILL_CAPABILITIES = { capabilities: { tools: {}, resources: {} } };

/** URI scheme under which skills are exposed as MCP resources. */
const RESOURCE_SCHEME = 'skill';

/**
 * Name of the meta-tool that returns the skill catalogue. A skill could in
 * theory be named `list_skills` too; the meta-tool wins (that skill stays
 * reachable as a resource and is omitted from the tool list to avoid a dupe).
 */
const INDEX_TOOL_NAME = 'list_skills';

/**
 * MCP tool names are conventionally restricted to `[A-Za-z0-9_-]`, but skill
 * names may contain dots — sanitize for the tool name and keep a reverse map
 * (built per request from the live skill list) to resolve calls back.
 */
function toolName(skill: Skill): string {
  return skill.name.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** The text handed to an agent when it loads a skill: the Markdown body, plus a note about any bundled files. */
function renderSkill(skill: Skill): string {
  const files = skill.files.filter((f) => f.type === 'file');
  if (files.length === 0) {
    return skill.body;
  }
  const list = files.map((f) => `- ${f.path}`).join('\n');
  return `${skill.body}\n\n---\nBundled supporting files (in the skill directory \`${skill.name}/\`):\n${list}\n`;
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
  };
}

/** The JSON catalogue returned by the index tool: every skill's metadata, no bodies. */
function renderIndex(skills: Skill[]): string {
  return JSON.stringify({ count: skills.length, skills: skills.map(indexEntry) }, null, 2);
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
}

/**
 * Build an MCP Server that serves a set of skills. Each skill is exposed BOTH
 * as a tool (calling it returns the skill's Markdown so an agent can load it on
 * demand) and as a resource (`skill://<name>`), so clients using either
 * mechanism can reach every skill.
 */
export function createSkillServer(deps: SkillServerDeps): Server {
  const server = new Server({ name: `mcp-skills/${deps.label}`, version: SERVER_VERSION }, SKILL_CAPABILITIES);

  const findByToolName = (name: string): Skill | undefined => deps.getSkills().find((s) => toolName(s) === name);
  const findByName = (name: string): Skill | undefined => deps.getSkills().find((s) => s.name === name);

  // Authoring tools are built once (closures over the store); whether they are
  // actually served is decided live per request via `authoringEnabled`.
  const authoringTools: AuthoringTool[] = deps.authoring ? buildAuthoringTools(deps.authoring) : [];
  const authoringEnabled = (): boolean => Boolean(deps.authoring?.store.isAuthoringEnabled());
  const activeAuthoringTools = (): AuthoringTool[] => (authoringEnabled() ? authoringTools : []);
  // Tool names that must never be shadowed by a same-named skill (the meta-tool + any authoring tools).
  const reservedNames = (): Set<string> =>
    new Set<string>([INDEX_TOOL_NAME, ...activeAuthoringTools().map((t) => t.definition.name)]);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const skills = deps.getSkills();
    const indexTool = {
      name: INDEX_TOOL_NAME,
      description:
        'List every skill available from this endpoint with its name, description, format, and supporting ' +
        'files — without loading any skill bodies. Call this first to decide which skill(s) to load, then call ' +
        "the tool named in each entry's `tool` field to fetch that skill's full contents.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    };
    const reserved = reservedNames();
    const skillTools = skills
      .filter((skill) => !reserved.has(toolName(skill)))
      .map((skill) => ({
        name: toolName(skill),
        description: skill.description || `Load the "${skill.name}" skill.`,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }));
    const authoring = activeAuthoringTools().map((t) => t.definition);
    return { tools: [indexTool, ...authoring, ...skillTools] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === INDEX_TOOL_NAME) {
      return { content: [{ type: 'text', text: renderIndex(deps.getSkills()) }] };
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
    return { content: [{ type: 'text', text: renderSkill(skill) }] };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: deps.getSkills().map((skill) => ({
      uri: `${RESOURCE_SCHEME}://${skill.name}`,
      name: skill.name,
      description: skill.description || undefined,
      mimeType: 'text/markdown',
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { uri } = req.params;
    const prefix = `${RESOURCE_SCHEME}://`;
    const name = uri.startsWith(prefix) ? decodeURIComponent(uri.slice(prefix.length)) : '';
    const skill = name ? findByName(name) : undefined;
    if (!skill) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown skill resource "${uri}"`);
    }
    return {
      contents: [{ uri, mimeType: 'text/markdown', text: renderSkill(skill) }],
    };
  });

  return server;
}
