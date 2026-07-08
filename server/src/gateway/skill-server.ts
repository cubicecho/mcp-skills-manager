import type { Skill, SkillFileRead } from '@mcp-skills/shared';
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
 * Name of the loader tool served in `loader` mode: a single `load_skill(name)`
 * tool that returns any skill's body, instead of one tool per skill. Keeps the
 * advertised tool count fixed regardless of how many skills exist.
 */
const LOAD_TOOL_NAME = 'load_skill';

/** How skills are advertised as tools (see settings.skillToolMode). */
type SkillToolMode = 'per-skill' | 'loader';

/**
 * MCP tool names are conventionally restricted to `[A-Za-z0-9_-]`, but skill
 * names may contain dots — sanitize for the tool name and keep a reverse map
 * (built per request from the live skill list) to resolve calls back.
 */
function toolName(skill: Skill): string {
  return skill.name.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Best-effort MIME type for a bundled supporting file exposed as a resource. */
function fileMimeType(relPath: string, binary: boolean): string {
  const ext = relPath.slice(relPath.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'txt':
      return 'text/plain';
    case 'py':
      return 'text/x-python';
    case 'js':
    case 'mjs':
      return 'text/javascript';
    case 'ts':
      return 'text/x-typescript';
    case 'yaml':
    case 'yml':
      return 'application/yaml';
    case 'csv':
      return 'text/csv';
    default:
      return binary ? 'application/octet-stream' : 'text/plain';
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
    const list = files.map((f) => `- ${f.path} — resource \`${RESOURCE_SCHEME}://${skill.name}/${f.path}\``).join('\n');
    sections.push(
      `---\nBundled supporting files (in the skill directory \`${skill.name}/\`), readable as MCP resources:\n${list}`,
    );
  }

  return sections.length === 1 ? skill.body : `${sections.join('\n\n')}\n`;
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
    ...skillMeta(skill),
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
  const skillToolMode = (): SkillToolMode => deps.getSkillToolMode?.() ?? 'per-skill';
  // Tool names that must never be shadowed by a same-named skill: the meta-tool,
  // any active authoring tools, and (in loader mode) the loader tool.
  const reservedNames = (): Set<string> => {
    const names = new Set<string>([INDEX_TOOL_NAME, ...activeAuthoringTools().map((t) => t.definition.name)]);
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
      return { tools: [indexToolFor(mode), loadTool, ...authoring] };
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
    return { tools: [indexToolFor(mode), ...authoring, ...skillTools] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === INDEX_TOOL_NAME) {
      return { content: [{ type: 'text', text: renderIndex(deps.getSkills()) }] };
    }
    if (skillToolMode() === 'loader' && req.params.name === LOAD_TOOL_NAME) {
      const raw = req.params.arguments?.name;
      const wanted = typeof raw === 'string' ? raw : '';
      // Accept the skill's real name (as listed by list_skills); fall back to a
      // sanitized tool name so callers coming from per-skill mode still resolve.
      const skill = findByName(wanted) ?? findByToolName(wanted);
      if (!skill) {
        throw new McpError(ErrorCode.InvalidParams, `Unknown skill "${wanted}"`);
      }
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
    return { content: [{ type: 'text', text: renderSkill(skill) }] };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = [];
    for (const skill of deps.getSkills()) {
      resources.push({
        uri: `${RESOURCE_SCHEME}://${skill.name}`,
        name: skill.name,
        description: skill.description || undefined,
        mimeType: 'text/markdown',
      });
      // Expose each bundled supporting file as its own resource — but only when
      // we can actually read file contents, so we never advertise a dead URI.
      if (deps.readSupportingFile) {
        for (const file of skill.files.filter((f) => f.type === 'file')) {
          resources.push({
            uri: `${RESOURCE_SCHEME}://${skill.name}/${file.path}`,
            name: `${skill.name}/${file.path}`,
            description: `Supporting file for the "${skill.name}" skill.`,
            mimeType: fileMimeType(file.path, false),
          });
        }
      }
    }
    return { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { uri } = req.params;
    const prefix = `${RESOURCE_SCHEME}://`;
    if (!uri.startsWith(prefix)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown skill resource "${uri}"`);
    }
    const rest = uri.slice(prefix.length);
    // Skill names never contain "/", so the first slash cleanly separates the
    // skill name from a bundled-file path: skill://<name> vs skill://<name>/<path>.
    const slash = rest.indexOf('/');

    if (slash === -1) {
      const name = decodeURIComponent(rest);
      const skill = name ? findByName(name) : undefined;
      if (!skill) {
        throw new McpError(ErrorCode.InvalidParams, `Unknown skill resource "${uri}"`);
      }
      return { contents: [{ uri, mimeType: 'text/markdown', text: renderSkill(skill) }] };
    }

    // Bundled supporting file.
    const skillName = decodeURIComponent(rest.slice(0, slash));
    const relPath = decodeURIComponent(rest.slice(slash + 1));
    // Guard visibility: only skills served by *this* endpoint (root/profile) are reachable.
    if (!findByName(skillName) || !deps.readSupportingFile) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown skill resource "${uri}"`);
    }
    let file: SkillFileRead;
    try {
      file = await deps.readSupportingFile(skillName, relPath);
    } catch (err) {
      throw new McpError(ErrorCode.InvalidParams, `Cannot read resource "${uri}": ${errorMessage(err)}`);
    }
    const mimeType = fileMimeType(relPath, file.binary);
    return {
      contents: [file.binary ? { uri, mimeType, blob: file.content } : { uri, mimeType, text: file.content }],
    };
  });

  return server;
}
