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

/** Wire a Client to a skill server for the given endpoint (root, or a workspace). */
async function connect(store: ConfigStore, workspaceSlug?: string): Promise<Client> {
  const getSkills = workspaceSlug
    ? () => {
        const workspace = store.getWorkspace(workspaceSlug);
        return workspace ? store.getSkillsForWorkspace(workspace) : [];
      }
    : () => store.getGlobalSkills();
  const server = createSkillServer({ label: workspaceSlug ?? 'all', getSkills, authoring: { store, workspaceSlug } });
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
    await store.init(); // seeds getting-started + examples workspace
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

  it('scopes a skill authored via a workspace: hidden from root, present in the workspace', async () => {
    const workspaceClient = await connect(store, 'examples');
    await workspaceClient.callTool({
      name: 'create_skill',
      arguments: { name: 'workspace-only', description: 'scoped', body: 'body' },
    });

    const scoped = store.getSkill('workspace-only');
    expect(scoped?.global).toBe(false);
    // Added to the workspace's member list.
    expect(store.getWorkspace('examples')?.skills).toContain('workspace-only');
    // Served on the workspace endpoint...
    expect((await workspaceClient.listTools()).tools.map((t) => t.name)).toContain('workspace-only');
    // ...but not on the root endpoint.
    const rootClient = await connect(store);
    expect((await rootClient.listTools()).tools.map((t) => t.name)).not.toContain('workspace-only');
    expect(store.getGlobalSkills().map((s) => s.name)).not.toContain('workspace-only');
  });

  it('lets a workspace author opt a skill into global visibility', async () => {
    const workspaceClient = await connect(store, 'examples');
    await workspaceClient.callTool({
      name: 'create_skill',
      arguments: { name: 'promoted', body: 'body', global: true },
    });
    expect(store.getSkill('promoted')?.global).toBe(true);
    // Both in the workspace and on the root aggregate.
    expect(store.getWorkspace('examples')?.skills).toContain('promoted');
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

  it('refuses every mutating tool on a read-only skill, while still letting it be read', async () => {
    const client = await connect(store);
    await client.callTool({ name: 'create_skill', arguments: { name: 'locked', description: 'd', body: 'original' } });
    await client.callTool({
      name: 'write_skill_file',
      arguments: { skill: 'locked', path: 'reference/notes.md', content: 'notes' },
    });
    // A human marks it read-only (the REST/UI path).
    await store.updateSkill('locked', { readOnly: true });

    const attempts: Array<{ name: string; arguments: Record<string, unknown> }> = [
      { name: 'update_skill', arguments: { name: 'locked', body: 'hacked' } },
      { name: 'rename_skill', arguments: { name: 'locked', new_name: 'unlocked' } },
      { name: 'delete_skill', arguments: { name: 'locked' } },
      { name: 'write_skill_file', arguments: { skill: 'locked', path: 'reference/notes.md', content: 'hacked' } },
      { name: 'write_skill_file', arguments: { skill: 'locked', path: 'new.md', content: 'new' } },
      { name: 'create_skill_folder', arguments: { skill: 'locked', path: 'extra' } },
      { name: 'move_skill_file', arguments: { skill: 'locked', from: 'reference/notes.md', to: 'moved.md' } },
      { name: 'delete_skill_file', arguments: { skill: 'locked', path: 'reference/notes.md' } },
    ];
    for (const attempt of attempts) {
      const res = await client.callTool(attempt);
      expect((res as { isError?: boolean }).isError, attempt.name).toBe(true);
      expect(firstText(res)).toContain('read-only');
    }

    // Nothing changed on disk.
    const skill = store.getSkill('locked');
    expect(skill?.readOnly).toBe(true);
    expect(skill?.body.trim()).toBe('original');
    expect(skill?.files.map((f) => f.path)).toEqual(['reference', 'reference/notes.md']);
    expect(store.getSkill('unlocked')).toBeUndefined();

    // Loading and reading still work, and the catalogue flags it.
    expect(firstText(await client.callTool({ name: 'locked' }))).toContain('original');
    expect(
      firstText(
        await client.callTool({ name: 'read_skill_file', arguments: { skill: 'locked', path: 'reference/notes.md' } }),
      ),
    ).toBe('notes');
    const catalogue = JSON.parse(firstText(await client.callTool({ name: 'list_skills' }))) as {
      skills: Array<{ name: string; readOnly?: boolean }>;
    };
    expect(catalogue.skills.find((s) => s.name === 'locked')?.readOnly).toBe(true);
    expect(catalogue.skills.find((s) => s.name === 'getting-started')).not.toHaveProperty('readOnly');
  });

  it('gives agents no way to lift the read-only flag, and allows edits again once a human does', async () => {
    const client = await connect(store);
    await client.callTool({ name: 'create_skill', arguments: { name: 'locked', body: 'original' } });
    await store.updateSkill('locked', { readOnly: true });

    // `readOnly` is not an update_skill argument, so smuggling it in changes nothing.
    await client.callTool({ name: 'update_skill', arguments: { name: 'locked', readOnly: false } });
    expect(store.getSkill('locked')?.readOnly).toBe(true);
    // Nor can a same-named skill be created over it.
    const dupe = await client.callTool({ name: 'create_skill', arguments: { name: 'locked', body: 'replacement' } });
    expect((dupe as { isError?: boolean }).isError).toBe(true);
    expect(store.getSkill('locked')?.body.trim()).toBe('original');

    await store.updateSkill('locked', { readOnly: false });
    await client.callTool({ name: 'update_skill', arguments: { name: 'locked', body: 'edited' } });
    expect(store.getSkill('locked')?.body.trim()).toBe('edited');
  });

  it('reports a friendly error for a duplicate skill name', async () => {
    const client = await connect(store);
    await client.callTool({ name: 'create_skill', arguments: { name: 'dupe', body: 'b' } });
    const res = await client.callTool({ name: 'create_skill', arguments: { name: 'dupe', body: 'b' } });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(firstText(res)).toContain('already exists');
  });

  it('pins the error text of create_skill name failures', async () => {
    const client = await connect(store);
    const missing = await client.callTool({ name: 'create_skill', arguments: { body: 'b' } });
    expect((missing as { isError?: boolean }).isError).toBe(true);
    expect(firstText(missing)).toMatchInlineSnapshot(`"Provide a "name" or a "title" to create a skill"`);
    const emptySlug = await client.callTool({ name: 'create_skill', arguments: { title: '!!!' } });
    expect(firstText(emptySlug)).toMatchInlineSnapshot(`"Provide a "name" or a "title" to create a skill"`);
    const invalid = await client.callTool({ name: 'create_skill', arguments: { name: 'Not A Slug' } });
    expect((invalid as { isError?: boolean }).isError).toBe(true);
    expect(firstText(invalid)).toMatchInlineSnapshot(
      `"lowercase alphanumerics, dots, dashes, underscores; must start alphanumeric"`,
    );
    const derived = await client.callTool({ name: 'create_skill', arguments: { title: 'My First Skill!' } });
    expect(firstText(derived)).toContain('Created skill "my-first-skill"');
    expect(store.getSkills().map((s) => s.name)).toEqual(['getting-started', 'my-first-skill']);
  });

  it('pins the error text of rename_skill with an invalid new name', async () => {
    const client = await connect(store);
    const res = await client.callTool({
      name: 'rename_skill',
      arguments: { name: 'getting-started', new_name: 'Not A Slug' },
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(firstText(res)).toMatchInlineSnapshot(`"Invalid skill name "Not A Slug""`);
    expect(store.getSkill('getting-started')).toBeDefined();
  });

  it('adds a renamed skill to the active workspace even when it was not a member', async () => {
    await store.createSkill({ name: 'outsider', description: '', body: 'b', format: 'file' });
    expect(store.getWorkspace('examples')?.skills).toEqual(['getting-started']);
    const client = await connect(store, 'examples');
    const text = firstText(
      await client.callTool({ name: 'rename_skill', arguments: { name: 'outsider', new_name: 'insider' } }),
    );
    expect(text).toMatchInlineSnapshot(
      `"Renamed skill "outsider" to "insider". It is served globally on the root /mcp endpoint and included in workspace "examples". Load it by calling the tool named "insider"."`,
    );
    expect(store.getWorkspace('examples')?.skills).toEqual(['getting-started', 'insider']);
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
