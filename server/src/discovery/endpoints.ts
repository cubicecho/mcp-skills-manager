import { hostname } from 'node:os';
import { type AdvertisedEndpoint, airIdentifier, createServerCard, type KeyValueInput } from '@cubicecho/mcp-discovery';
import { isAuthEffective } from '../auth.ts';
import type { ConfigStore } from '../config/store.ts';
import { SERVER_VERSION } from '../version.ts';

/** The reverse-DNS namespace every card's name starts with; the host's slug is appended to it. */
const CARD_NAMESPACE = 'io.github.cubicecho.mcp-skills';

/** The project's source, shown on every card. */
const REPOSITORY = { url: 'https://github.com/cubicecho/mcp-skills-manager', source: 'github' } as const;

/** The path of the endpoint that serves every global skill. */
const ROOT_PATH = '/mcp';

/** The header a client must send when bearer auth is on; its value is never in the card. */
const AUTH_HEADER: KeyValueInput = {
  name: 'Authorization',
  description: 'Bearer <token>, the token from settings.json or MCP_SKILLS_TOKEN',
  isRequired: true,
  isSecret: true,
};

/**
 * A hostname cut down to what a card name and a `urn:air` id allow: lowercase letters, digits and hyphens.
 *
 * @param name - The machine's hostname.
 * @returns E.g. `nas` for `NAS`, `my-box` for `my_box.lan`.
 */
export function hostSlug(name: string): string {
  const [first = ''] = name.toLowerCase().split('.');
  return first.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'host';
}

/**
 * The MCP endpoints this server makes discoverable: `/mcp`, and `/mcp/w/<slug>` for each enabled workspace.
 *
 * @param store - Where the workspaces and auth settings are read from; read on every call.
 * @param [host] - The machine's hostname, which keeps card names apart when two servers share a network.
 * @returns The endpoints, each with a card builder that names the URL the request came in on.
 */
export function discoveryEndpoints(store: ConfigStore, host = hostname()): AdvertisedEndpoint[] {
  const slug = hostSlug(host);
  const headers = isAuthEffective(store.getSettings()) ? [AUTH_HEADER] : [];
  const endpoint = (path: string, name: string, description: string, title: string): AdvertisedEndpoint => ({
    path,
    identifier: airIdentifier(`${slug}.mcp-skills`, name),
    card: ({ endpointUrl }) =>
      createServerCard({
        name: `${CARD_NAMESPACE}.${slug}/${name}`,
        version: SERVER_VERSION,
        title,
        description,
        repository: REPOSITORY,
        remotes: [{ type: 'streamable-http', url: endpointUrl, headers }],
      }),
  });
  const workspaces = store
    .getWorkspaces()
    .filter((workspace) => workspace.enabled)
    .map((workspace) =>
      endpoint(
        `${ROOT_PATH}/w/${workspace.slug}`,
        `w-${workspace.slug}`,
        'One workspace of skills for agents, served over MCP.',
        workspace.name,
      ),
    );
  return [endpoint(ROOT_PATH, 'skills', 'Skills for agents, served over MCP.', `MCP Skills on ${host}`), ...workspaces];
}
