import type { SkillToolMode } from '@mcp-skills/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Name of the meta-tool that returns the skill catalogue. A skill could in
 * theory be named `list_skills` too; the meta-tool wins (that skill stays
 * reachable as a resource and is omitted from the tool list to avoid a dupe).
 */
export const INDEX_TOOL_NAME = 'list_skills';

/**
 * Name of the loader tool served in `loader` mode: a single `load_skill(name)`
 * tool that returns any skill's body, instead of one tool per skill. Keeps the
 * advertised tool count fixed regardless of how many skills exist.
 */
export const LOAD_TOOL_NAME = 'load_skill';

/**
 * Name of the search meta-tool: full-text lookup over the catalogue (name,
 * description, tags, and body) so an agent can find relevant skills by intent
 * without loading every body. Returns the same catalogue lines as `list_skills`.
 */
export const SEARCH_TOOL_NAME = 'search_skills';

/** JSON Schema for a tool that takes no arguments. */
export const NO_ARGS_SCHEMA: Tool['inputSchema'] = { type: 'object', properties: {}, additionalProperties: false };

/** How an agent loads a skill it found in the catalogue, by how the endpoint advertises skills. */
const HOW_TO_LOAD: Record<SkillToolMode, string> = {
  loader: 'call `load_skill` with the name of each to fetch its full contents.',
  'per-skill':
    'call the tool named after each to fetch its full contents (its notes say `tool …` where that name ' +
    'differs from the skill’s).',
};

/**
 * Build the definition of the catalogue tool.
 * @param mode - How skills are advertised; it decides which loading hint the description gives.
 * @returns The `list_skills` tool definition.
 */
export function indexToolDefinition(mode: SkillToolMode): Tool {
  return {
    name: INDEX_TOOL_NAME,
    description:
      'List every skill available from this endpoint, one per line and without loading any skill bodies: ' +
      '`name [#tags] (notes): description`. The notes give its supporting files, `read-only` when the ' +
      'authoring tools will refuse it, and when it last changed. Call this first to decide which skill(s) to ' +
      `load, then ${HOW_TO_LOAD[mode]}`,
    inputSchema: NO_ARGS_SCHEMA,
  };
}

/** Definition of the `search_skills` tool. */
export const SEARCH_TOOL_DEFINITION: Tool = {
  name: SEARCH_TOOL_NAME,
  description:
    'Search this endpoint’s skills by intent and return the matching catalogue lines, in the format of ' +
    '`list_skills` (metadata only, no bodies). Provide a free-text `query` (matched against each skill’s ' +
    'name, description, tags, and body) and/or a `tags` filter. Use this instead of `list_skills` when you ' +
    'know roughly what you need but not the exact skill name; then load a match as usual.',
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

/** Definition of the `load_skill` tool, advertised in `loader` mode only. */
export const LOAD_TOOL_DEFINITION: Tool = {
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
