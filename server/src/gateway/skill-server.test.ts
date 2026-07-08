import type { Skill } from '@mcp-skills/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSkillServer } from './skill-server.ts';

function skill(overrides: Partial<Skill> & Pick<Skill, 'name'>): Skill {
  return {
    description: '',
    body: `# ${overrides.name}\n\nbody`,
    frontmatter: {},
    format: 'file',
    global: true,
    path: `${overrides.name}.md`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: [],
    ...overrides,
  };
}

const SKILLS: Skill[] = [
  skill({ name: 'commit.messages', description: 'Write conventional commit messages.' }),
  skill({
    name: 'pdf-forms',
    description: 'Fill and inspect PDF forms.',
    format: 'dir',
    path: 'pdf-forms/SKILL.md',
    files: [
      { path: 'reference.md', type: 'file', size: 120 },
      { path: 'scripts', type: 'dir', size: 0 },
      { path: 'scripts/fill.py', type: 'file', size: 340 },
    ],
  }),
];

/** The text of a tool result's first content block. */
function firstText(res: unknown): string {
  const block = (res as { content?: Array<{ type: string; text: string }> }).content?.[0];
  if (!block) throw new Error('tool result had no content');
  return block.text;
}

/** The first resource-content block, widened past the text|blob union for assertions. */
function firstContent(res: { contents: unknown[] }): { text?: string; blob?: string; mimeType?: string } {
  return res.contents[0] as { text?: string; blob?: string; mimeType?: string };
}

type ConnectOpts = Omit<Parameters<typeof createSkillServer>[0], 'getSkills' | 'label'>;

/** Wire a Client to a fresh skill server over a linked in-memory transport pair. */
async function connect(getSkills: () => Skill[], opts: ConnectOpts = {}): Promise<Client> {
  const server = createSkillServer({ getSkills, label: 'test', ...opts });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('skill-server index tool', () => {
  let client: Client;
  beforeEach(async () => {
    client = await connect(() => SKILLS);
  });

  it('advertises the index tool first, ahead of the skill tools', async () => {
    const { tools } = await client.listTools();
    expect(tools[0]?.name).toBe('list_skills');
    expect(tools.map((t) => t.name)).toEqual(['list_skills', 'commit_messages', 'pdf-forms']);
  });

  it('returns a catalogue of metadata without any skill bodies', async () => {
    const text = firstText(await client.callTool({ name: 'list_skills' }));
    const index = JSON.parse(text) as {
      count: number;
      skills: Array<{ name: string; tool: string; description: string; format: string; files: string[] }>;
    };

    expect(index.count).toBe(2);
    expect(text).not.toContain('body'); // metadata only — no skill contents
    expect(index.skills[0]).toEqual({
      name: 'commit.messages',
      tool: 'commit_messages',
      description: 'Write conventional commit messages.',
      format: 'file',
      files: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    // Directory skills list their supporting files but not sub-directories.
    expect(index.skills[1]?.files).toEqual(['reference.md', 'scripts/fill.py']);
  });

  it('loads a skill body via the tool name from the catalogue', async () => {
    const text = firstText(await client.callTool({ name: 'commit_messages' }));
    expect(text).toContain('# commit.messages');
  });

  it('reflects the live skill list on each call', async () => {
    let skills = [...SKILLS];
    const live = await connect(() => skills);
    skills = [skill({ name: 'solo' })];
    const index = JSON.parse(firstText(await live.callTool({ name: 'list_skills' }))) as { count: number };
    expect(index.count).toBe(1);
  });
});

describe('skill-server loader mode', () => {
  let client: Client;
  beforeEach(async () => {
    client = await connect(() => SKILLS, { getSkillToolMode: () => 'loader' });
  });

  it('advertises only list_skills + load_skill regardless of catalogue size', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_skills', 'load_skill']);
    // The loader tool takes a `name` argument, unlike the no-arg per-skill tools.
    expect(tools[1]?.inputSchema.required).toEqual(['name']);
  });

  it('loads any skill body by name through load_skill', async () => {
    const text = firstText(await client.callTool({ name: 'load_skill', arguments: { name: 'commit.messages' } }));
    expect(text).toContain('# commit.messages');
  });

  it('errors on an unknown skill name', async () => {
    await expect(client.callTool({ name: 'load_skill', arguments: { name: 'nope' } })).rejects.toThrow(/Unknown skill/);
  });

  it('resolves only by the real skill name, not the sanitized tool name', async () => {
    // `commit.messages` sanitizes to `commit_messages`; the loader must not accept
    // the tool-name form (ambiguous across distinct slugs) — only the listed name.
    await expect(client.callTool({ name: 'load_skill', arguments: { name: 'commit_messages' } })).rejects.toThrow(
      /Unknown skill/,
    );
  });
});

describe('skill-server metadata surfacing', () => {
  const META_SKILLS: Skill[] = [
    skill({
      name: 'licensed',
      description: 'A skill with license and allowed-tools frontmatter.',
      frontmatter: { license: 'Apache-2.0', 'allowed-tools': ['Read', 'Bash'] },
    }),
    skill({
      name: 'csv-tools',
      description: 'allowed-tools given as a comma-separated string.',
      frontmatter: { 'allowed-tools': 'Read, Write , Edit' },
    }),
  ];

  it('includes license and allowedTools in the list_skills catalogue', async () => {
    const client = await connect(() => META_SKILLS);
    const index = JSON.parse(firstText(await client.callTool({ name: 'list_skills' }))) as {
      skills: Array<{ name: string; license?: string; allowedTools?: string[] }>;
    };
    expect(index.skills[0]).toMatchObject({ license: 'Apache-2.0', allowedTools: ['Read', 'Bash'] });
    // Comma-separated strings are split and trimmed; skills without a license omit the key.
    expect(index.skills[1]?.allowedTools).toEqual(['Read', 'Write', 'Edit']);
    expect(index.skills[1]).not.toHaveProperty('license');
  });

  it('appends a metadata footer to the rendered skill body', async () => {
    const client = await connect(() => META_SKILLS);
    const text = firstText(await client.callTool({ name: 'licensed' }));
    expect(text).toContain('# licensed'); // body still present
    expect(text).toContain('Allowed tools');
    expect(text).toContain('Read');
    expect(text).toContain('Bash');
    expect(text).toContain('License');
    expect(text).toContain('Apache-2.0');
  });

  it('omits the footer for skills without license or allowed-tools', async () => {
    const client = await connect(() => SKILLS);
    const text = firstText(await client.callTool({ name: 'commit_messages' }));
    expect(text).not.toContain('Allowed tools');
    expect(text).not.toContain('License');
  });
});

describe('skill-server resources', () => {
  it('lists each skill plus its bundled files as resources when file reads are wired', async () => {
    const client = await connect(() => SKILLS, {
      readSupportingFile: async () => ({ path: '', content: '', encoding: 'utf8', size: 0, binary: false }),
    });
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('skill://commit.messages');
    expect(uris).toContain('skill://pdf-forms');
    // Bundled files (not sub-directories) become their own resources.
    expect(uris).toContain('skill://pdf-forms/reference.md');
    expect(uris).toContain('skill://pdf-forms/scripts/fill.py');
    expect(uris).not.toContain('skill://pdf-forms/scripts');
  });

  it('does not advertise file resources when no file reader is provided', async () => {
    const client = await connect(() => SKILLS);
    const uris = (await client.listResources()).resources.map((r) => r.uri);
    expect(uris).toEqual(['skill://commit.messages', 'skill://pdf-forms']);
  });

  it('reads a bundled file resource through readSupportingFile', async () => {
    const client = await connect(() => SKILLS, {
      readSupportingFile: async (name, relPath) => ({
        path: relPath,
        content: `contents of ${name}/${relPath}`,
        encoding: 'utf8',
        size: 10,
        binary: false,
      }),
    });
    const res = await client.readResource({ uri: 'skill://pdf-forms/reference.md' });
    expect(firstContent(res).text).toBe('contents of pdf-forms/reference.md');
    expect(firstContent(res).mimeType).toBe('text/markdown');
  });

  it('returns binary bundled files as a base64 blob', async () => {
    const client = await connect(() => SKILLS, {
      readSupportingFile: async () => ({ path: 'x.bin', content: 'AAEC', encoding: 'base64', size: 3, binary: true }),
    });
    const res = await client.readResource({ uri: 'skill://pdf-forms/scripts/fill.py' });
    expect(firstContent(res).blob).toBe('AAEC');
    expect(firstContent(res).text).toBeUndefined();
  });

  it('rejects a file resource for a skill outside the served set', async () => {
    const client = await connect(() => SKILLS, {
      readSupportingFile: async () => ({ path: '', content: 'leak', encoding: 'utf8', size: 4, binary: false }),
    });
    await expect(client.readResource({ uri: 'skill://other-skill/secret.md' })).rejects.toThrow(
      /Unknown skill resource/,
    );
  });

  it('rejects a malformed percent-encoded URI cleanly instead of throwing a URIError', async () => {
    const client = await connect(() => SKILLS, {
      readSupportingFile: async () => ({ path: '', content: '', encoding: 'utf8', size: 0, binary: false }),
    });
    // A lone `%` is an invalid escape — must surface as InvalidParams, not a raw URIError.
    await expect(client.readResource({ uri: 'skill://%' })).rejects.toThrow(/Unknown skill resource/);
    await expect(client.readResource({ uri: 'skill://pdf-forms/%E0%A4%A' })).rejects.toThrow(/Unknown skill resource/);
  });

  it('ignores a URI query/fragment when resolving the bundled-file path', async () => {
    const client = await connect(() => SKILLS, {
      readSupportingFile: async (name, relPath) => ({
        path: relPath,
        content: `contents of ${name}/${relPath}`,
        encoding: 'utf8',
        size: 10,
        binary: false,
      }),
    });
    const res = await client.readResource({ uri: 'skill://pdf-forms/reference.md?v=2' });
    // relPath must be reference.md, not reference.md?v=2.
    expect(firstContent(res).text).toBe('contents of pdf-forms/reference.md');
  });

  it('omits mimeType for a bundled file with an unknown extension (never mislabels as text)', async () => {
    const noExtSkill = skill({
      name: 'assets',
      format: 'dir',
      path: 'assets/SKILL.md',
      files: [{ path: 'LICENSE', type: 'file', size: 40 }],
    });
    const client = await connect(() => [noExtSkill], {
      readSupportingFile: async () => ({ path: 'LICENSE', content: 'x', encoding: 'utf8', size: 1, binary: false }),
    });
    const listed = (await client.listResources()).resources.find((r) => r.uri === 'skill://assets/LICENSE');
    expect(listed?.mimeType).toBeUndefined();
  });
});
