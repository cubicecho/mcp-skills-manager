/** Body of the starter skill. */
const GETTING_STARTED_BODY = `# Getting started

Welcome to **MCP Skills Manager**. This is a starter skill, created automatically
because your data directory was empty. Feel free to edit or delete it.

## What a skill is

A skill is a Markdown document that an agent can load over MCP. Each skill is
served two ways at once:

- as an MCP **tool** — calling it returns this Markdown body;
- as an MCP **resource** at \`skill://<name>\`.

## Authoring skills

Skills live under \`DATA_DIR/skills\` in one of two shapes:

- a flat file: \`skills/<name>.md\`
- a directory: \`skills/<name>/SKILL.md\` plus any supporting files

Both start with YAML frontmatter carrying \`name\` and \`description\`, followed by
the Markdown body. Edit them here in the web UI, or on disk — changes are picked
up automatically.

## Workspaces

Group a subset of skills into a **workspace** to serve them at their own endpoint,
\`/mcp/w/<slug>\`. This skill belongs to the seeded "Examples" workspace.
`;

/** The skill written on a fresh install, so every surface has working content to show. */
export const STARTER_SKILL = {
  name: 'getting-started',
  description: 'How MCP Skills Manager works and how to author your own skills.',
  body: GETTING_STARTED_BODY,
};

/** The workspace written on a fresh install; it lists the starter skill. */
export const STARTER_WORKSPACE = {
  name: 'Examples',
  slug: 'examples',
  description: 'A starter workspace. Edit or delete it once you add your own skills.',
  skills: [STARTER_SKILL.name],
};
