import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config/store.ts';
import { createSkillServer } from './skill-server.ts';

/** The text of a tool result's first content block. */
function firstText(res: unknown): string {
  const block = (res as { content?: Array<{ type: string; text: string }> }).content?.[0];
  if (!block) throw new Error('tool result had no content');
  return block.text;
}

/** Wire a Client to a skill server for the given endpoint (root, or a profile). */
async function connect(store: ConfigStore, profileSlug?: string): Promise<Client> {
  const getSkills = profileSlug
    ? () => {
        const profile = store.getProfile(profileSlug);
        return profile ? store.getSkillsForProfile(profile) : [];
      }
    : () => store.getGlobalSkills();
  const server = createSkillServer({ label: profileSlug ?? 'all', getSkills, authoring: { store, profileSlug } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('MCP authoring tools', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-authoring-'));
    store = new ConfigStore(dir);
    await store.init(); // seeds getting-started + examples profile
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('advertises authoring tools on the root endpoint', async () => {
    const client = await connect(store);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('create_skill');
    expect(names).toContain('update_skill');
    expect(names).toContain('write_skill_file');
    expect(names).toContain('read_skill_file');
    expect(names).toContain('delete_skill');
  });

  it('creates a global skill (dir format by default) from the root endpoint', async () => {
    const client = await connect(store);
    const text = firstText(
      await client.callTool({
        name: 'create_skill',
        arguments: { name: 'my-skill', description: 'A test skill', body: '# Hi' },
      }),
    );
    expect(text).toContain('Created skill "my-skill"');
    const skill = store.getSkill('my-skill');
    expect(skill?.format).toBe('dir');
    expect(skill?.global).toBe(true);
    // Loadable via its tool name over MCP.
    expect(firstText(await client.callTool({ name: 'my-skill' }))).toContain('# Hi');
  });

  it('scopes a skill authored via a profile: hidden from root, present in the profile', async () => {
    const profileClient = await connect(store, 'examples');
    await profileClient.callTool({
      name: 'create_skill',
      arguments: { name: 'profile-only', description: 'scoped', body: 'body' },
    });

    const scoped = store.getSkill('profile-only');
    expect(scoped?.global).toBe(false);
    // Added to the profile's member list.
    expect(store.getProfile('examples')?.skills).toContain('profile-only');
    // Served on the profile endpoint...
    expect((await profileClient.listTools()).tools.map((t) => t.name)).toContain('profile-only');
    // ...but not on the root endpoint.
    const rootClient = await connect(store);
    expect((await rootClient.listTools()).tools.map((t) => t.name)).not.toContain('profile-only');
    expect(store.getGlobalSkills().map((s) => s.name)).not.toContain('profile-only');
  });

  it('lets a profile author opt a skill into global visibility', async () => {
    const profileClient = await connect(store, 'examples');
    await profileClient.callTool({
      name: 'create_skill',
      arguments: { name: 'promoted', body: 'body', global: true },
    });
    expect(store.getSkill('promoted')?.global).toBe(true);
    // Both in the profile and on the root aggregate.
    expect(store.getProfile('examples')?.skills).toContain('promoted');
    expect(store.getGlobalSkills().map((s) => s.name)).toContain('promoted');
  });

  it('toggles global visibility via update_skill', async () => {
    const client = await connect(store);
    await client.callTool({ name: 'create_skill', arguments: { name: 'toggle-me', body: 'b' } });
    expect(store.getSkill('toggle-me')?.global).toBe(true);
    await client.callTool({ name: 'update_skill', arguments: { name: 'toggle-me', global: false } });
    expect(store.getSkill('toggle-me')?.global).toBe(false);
    expect(store.getGlobalSkills().map((s) => s.name)).not.toContain('toggle-me');
    await client.callTool({ name: 'update_skill', arguments: { name: 'toggle-me', global: true } });
    expect(store.getSkill('toggle-me')?.global).toBe(true);
  });

  it('updates a skill body in place', async () => {
    const client = await connect(store);
    await client.callTool({ name: 'create_skill', arguments: { name: 'edit-me', body: 'old' } });
    await client.callTool({ name: 'update_skill', arguments: { name: 'edit-me', body: 'new body' } });
    // Bodies round-trip through frontmatter (de)serialization, which normalizes surrounding whitespace.
    expect(store.getSkill('edit-me')?.body.trim()).toBe('new body');
  });

  it('writes and reads a supporting ref file', async () => {
    const client = await connect(store);
    await client.callTool({ name: 'create_skill', arguments: { name: 'with-files', body: 'b' } });
    const write = firstText(
      await client.callTool({
        name: 'write_skill_file',
        arguments: { skill: 'with-files', path: 'reference/notes.md', content: 'hello notes' },
      }),
    );
    expect(write).toContain('reference/notes.md');
    const read = firstText(
      await client.callTool({
        name: 'read_skill_file',
        arguments: { skill: 'with-files', path: 'reference/notes.md' },
      }),
    );
    expect(read).toBe('hello notes');
    // The written file surfaces in the catalogue.
    expect(store.getSkill('with-files')?.files.map((f) => f.path)).toContain('reference/notes.md');
  });

  it('renames and deletes a skill', async () => {
    const client = await connect(store);
    await client.callTool({ name: 'create_skill', arguments: { name: 'temp', body: 'b' } });
    await client.callTool({ name: 'rename_skill', arguments: { name: 'temp', new_name: 'renamed' } });
    expect(store.getSkill('temp')).toBeUndefined();
    expect(store.getSkill('renamed')).toBeDefined();
    await client.callTool({ name: 'delete_skill', arguments: { name: 'renamed' } });
    expect(store.getSkill('renamed')).toBeUndefined();
  });

  it('reports a friendly error for a duplicate skill name', async () => {
    const client = await connect(store);
    await client.callTool({ name: 'create_skill', arguments: { name: 'dupe', body: 'b' } });
    const res = await client.callTool({ name: 'create_skill', arguments: { name: 'dupe', body: 'b' } });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(firstText(res)).toContain('already exists');
  });

  it('omits authoring tools when authoringEnabled is false', async () => {
    await store.updateSettings({ authoringEnabled: false });
    const client = await connect(store);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('create_skill');
    // With authoring off the tool no longer exists — the call is rejected as an unknown tool, not executed.
    await expect(client.callTool({ name: 'create_skill', arguments: { name: 'nope', body: 'b' } })).rejects.toThrow(
      /Unknown skill tool/,
    );
    expect(store.getSkill('nope')).toBeUndefined();
  });
});
