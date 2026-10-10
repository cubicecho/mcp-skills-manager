import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Skill } from '@mcp-skills/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config/store.ts';
import { createSkillServer } from './skill-server.ts';

function skill(overrides: Partial<Skill> & Pick<Skill, 'name'>): Skill {
  return {
    description: '',
    body: `# ${overrides.name}\n\nbody`,
    frontmatter: {},
    format: 'file',
    global: true,
    readOnly: false,
    path: `${overrides.name}.md`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: [],
    tags: [],
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
    expect(tools.map((t) => t.name)).toEqual(['list_skills', 'search_skills', 'commit_messages', 'pdf-forms']);
  });

  it('returns a catalogue of metadata without any skill bodies', async () => {
    const text = firstText(await client.callTool({ name: 'list_skills' }));

    // One line per skill under the count: metadata only, and no sub-directories among the files.
    expect(text).toBe(
      [
        'skills: 2',
        'commit.messages (tool commit_messages; changed 2026-01-01): Write conventional commit messages.',
        'pdf-forms (files: reference.md, scripts/fill.py; changed 2026-01-01): Fill and inspect PDF forms.',
      ].join('\n'),
    );
  });

  it('keeps each skill to one line, with its tags, and says when there are none', async () => {
    const tagged = await connect(() => [
      skill({ name: 'solo', description: 'Line one.\n  Line two.', tags: ['a', 'b'] }),
    ]);
    expect(firstText(await tagged.callTool({ name: 'list_skills' }))).toBe(
      'skills: 1\nsolo [#a #b] (changed 2026-01-01): Line one. Line two.',
    );
    const empty = await connect(() => []);
    expect(firstText(await empty.callTool({ name: 'list_skills' }))).toBe('No skills.');
  });

  it('loads a skill body via the tool name from the catalogue', async () => {
    const text = firstText(await client.callTool({ name: 'commit_messages' }));
    expect(text).toContain('# commit.messages');
  });

  it('reflects the live skill list on each call', async () => {
    let skills = [...SKILLS];
    const live = await connect(() => skills);
    skills = [skill({ name: 'solo' })];
    expect(firstText(await live.callTool({ name: 'list_skills' }))).toMatch(/^skills: 1\nsolo /);
  });
});

describe('skill-server usage callback', () => {
  it('fires onSkillLoaded with the skill name when a body is loaded (per-skill and loader)', async () => {
    const loaded: string[] = [];
    const perSkill = await connect(() => SKILLS, { onSkillLoaded: (name) => loaded.push(name) });
    await perSkill.callTool({ name: 'commit_messages' });
    expect(loaded).toEqual(['commit.messages']);

    const loader = await connect(() => SKILLS, {
      getSkillToolMode: () => 'loader',
      onSkillLoaded: (name) => loaded.push(name),
    });
    await loader.callTool({ name: 'load_skill', arguments: { name: 'pdf-forms' } });
    expect(loaded).toEqual(['commit.messages', 'pdf-forms']);
  });

  it('does not fire onSkillLoaded for the catalogue tool', async () => {
    const loaded: string[] = [];
    const client = await connect(() => SKILLS, { onSkillLoaded: (name) => loaded.push(name) });
    await client.callTool({ name: 'list_skills' });
    expect(loaded).toEqual([]);
  });
});

describe('skill-server search tool', () => {
  const TAGGED: Skill[] = [
    skill({ name: 'commit.messages', description: 'Write conventional commit messages.', tags: ['git'] }),
    skill({ name: 'pdf-forms', description: 'Fill and inspect PDF forms.', tags: ['documents'] }),
    skill({ name: 'grep-guide', description: 'Search code effectively.', body: '# grep-guide\n\nuse ripgrep' }),
  ];

  /** The skill names of a catalogue: the first word of every line under the count. */
  const names = (text: string): string[] =>
    text
      .split('\n')
      .slice(1)
      .map((line) => line.split(' ')[0] ?? '');

  let client: Client;
  beforeEach(async () => {
    client = await connect(() => TAGGED);
  });

  it('advertises the search tool right after the catalogue tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).slice(0, 2)).toEqual(['list_skills', 'search_skills']);
  });

  it('matches the query across name, description, tags, and body', async () => {
    expect(names(firstText(await client.callTool({ name: 'search_skills', arguments: { query: 'commit' } })))).toEqual([
      'commit.messages',
    ]);
    // Body-only hit: "ripgrep" appears in grep-guide's body, nowhere in its metadata.
    expect(names(firstText(await client.callTool({ name: 'search_skills', arguments: { query: 'ripgrep' } })))).toEqual(
      ['grep-guide'],
    );
  });

  it('requires every whitespace-separated term to match (AND semantics)', async () => {
    const hit = firstText(await client.callTool({ name: 'search_skills', arguments: { query: 'pdf inspect' } }));
    expect(names(hit)).toEqual(['pdf-forms']);
    const miss = firstText(await client.callTool({ name: 'search_skills', arguments: { query: 'pdf commit' } }));
    expect(names(miss)).toEqual([]);
  });

  it('filters by tag, case-insensitively, independent of the query', async () => {
    const byTag = firstText(await client.callTool({ name: 'search_skills', arguments: { tags: ['GIT'] } }));
    expect(names(byTag)).toEqual(['commit.messages']);
  });

  it('returns the whole catalogue when given no query or tags (mirrors list_skills)', async () => {
    const all = firstText(await client.callTool({ name: 'search_skills', arguments: {} }));
    expect(names(all)).toEqual(['commit.messages', 'pdf-forms', 'grep-guide']);
  });
});

describe('skill-server loader mode', () => {
  let client: Client;
  beforeEach(async () => {
    client = await connect(() => SKILLS, { getSkillToolMode: () => 'loader' });
  });

  it('advertises only the meta-tools + load_skill regardless of catalogue size', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_skills', 'search_skills', 'load_skill']);
    // The loader tool takes a `name` argument, unlike the no-arg per-skill tools.
    expect(tools[2]?.inputSchema.required).toEqual(['name']);
  });

  it('leaves the per-skill tool name out of the catalogue, since load_skill takes the name', async () => {
    expect(firstText(await client.callTool({ name: 'list_skills' }))).toContain('\ncommit.messages (changed ');
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
    const [, licensed, csvTools] = firstText(await client.callTool({ name: 'list_skills' })).split('\n');
    expect(licensed).toContain('(allowed tools: Read, Bash; license Apache-2.0; changed ');
    // Comma-separated strings are split and trimmed; skills without a license say nothing of one.
    expect(csvTools).toContain('(allowed tools: Read, Write, Edit; changed ');
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

  it('annotates the skill resource with audience + lastModified and sizes bundled files', async () => {
    const client = await connect(() => SKILLS, {
      readSupportingFile: async () => ({ path: '', content: '', encoding: 'utf8', size: 0, binary: false }),
    });
    const { resources } = await client.listResources();
    const doc = resources.find((r) => r.uri === 'skill://pdf-forms');
    expect(doc?.annotations).toMatchObject({ audience: ['assistant'], lastModified: '2026-01-01T00:00:00.000Z' });
    const file = resources.find((r) => r.uri === 'skill://pdf-forms/reference.md');
    expect(file?.size).toBe(120);
    expect(file?.annotations?.audience).toEqual(['assistant']);
  });

  it('rejects an unknown resource with the spec resource-not-found code (-32002)', async () => {
    const client = await connect(() => SKILLS);
    await expect(client.readResource({ uri: 'skill://does-not-exist' })).rejects.toMatchObject({
      code: -32002,
    });
  });

  it('surfaces a frontmatter `title` as the resource title, and omits it otherwise', async () => {
    const titled = skill({ name: 'titled', frontmatter: { title: 'My Nice Skill' } });
    const client = await connect(() => [titled, ...SKILLS]);
    const { resources } = await client.listResources();
    expect(resources.find((r) => r.uri === 'skill://titled')?.title).toBe('My Nice Skill');
    expect(resources.find((r) => r.uri === 'skill://pdf-forms')?.title).toBeUndefined();
  });

  it('percent-encodes bundled-file URIs so special characters round-trip through read', async () => {
    const spaced = skill({
      name: 'spaced',
      format: 'dir',
      path: 'spaced/SKILL.md',
      files: [{ path: 'notes/read me.md', type: 'file', size: 5 }],
    });
    const client = await connect(() => [spaced], {
      readSupportingFile: async (name, relPath) => ({
        path: relPath,
        content: `contents of ${name}/${relPath}`,
        encoding: 'utf8',
        size: 10,
        binary: false,
      }),
    });
    const listed = (await client.listResources()).resources.find((r) => r.name === 'spaced/notes/read me.md');
    expect(listed?.uri).toBe('skill://spaced/notes/read%20me.md');
    // The advertised (encoded) URI must resolve back to the raw path on read.
    const res = await client.readResource({ uri: 'skill://spaced/notes/read%20me.md' });
    expect(firstContent(res).text).toBe('contents of spaced/notes/read me.md');
  });
});

describe('skill-server resource templates + completion', () => {
  it('lists only the skill template when file reads are not wired', async () => {
    const client = await connect(() => SKILLS);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toEqual(['skill://{name}']);
  });

  it('adds the bundled-file template when file reads are wired', async () => {
    const client = await connect(() => SKILLS, {
      readSupportingFile: async () => ({ path: '', content: '', encoding: 'utf8', size: 0, binary: false }),
    });
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toEqual(['skill://{name}', 'skill://{name}/{+path}']);
    // The file template carries no fixed mimeType (bundled files vary).
    expect(resourceTemplates.find((t) => t.uriTemplate === 'skill://{name}/{+path}')?.mimeType).toBeUndefined();
  });

  it('completes skill names by prefix for the {name} variable', async () => {
    const client = await connect(() => SKILLS);
    const res = await client.complete({
      ref: { type: 'ref/resource', uri: 'skill://{name}' },
      argument: { name: 'name', value: 'pdf' },
    });
    expect(res.completion.values).toEqual(['pdf-forms']);
    expect(res.completion.total).toBe(1);
    expect(res.completion.hasMore).toBe(false);
  });

  it('completes bundled-file paths for {+path}, scoped to the chosen skill', async () => {
    const client = await connect(() => SKILLS, {
      readSupportingFile: async () => ({ path: '', content: '', encoding: 'utf8', size: 0, binary: false }),
    });
    const res = await client.complete({
      ref: { type: 'ref/resource', uri: 'skill://{name}/{+path}' },
      argument: { name: 'path', value: 'scripts/' },
      context: { arguments: { name: 'pdf-forms' } },
    });
    expect(res.completion.values).toEqual(['scripts/fill.py']);
  });

  it('returns no path completions without a chosen skill in context', async () => {
    const client = await connect(() => SKILLS, {
      readSupportingFile: async () => ({ path: '', content: '', encoding: 'utf8', size: 0, binary: false }),
    });
    const res = await client.complete({
      ref: { type: 'ref/resource', uri: 'skill://{name}/{+path}' },
      argument: { name: 'path', value: '' },
    });
    expect(res.completion.values).toEqual([]);
  });

  it('advertises the completions capability', async () => {
    const client = await connect(() => SKILLS);
    expect(client.getServerCapabilities()?.completions).toEqual({});
  });
});

describe('skill-server resource pagination', () => {
  const many = Array.from({ length: 250 }, (_, i) => skill({ name: `skill-${String(i).padStart(3, '0')}` }));

  it('caps a page at 100 resources and yields a nextCursor until exhausted', async () => {
    const client = await connect(() => many);
    const first = await client.listResources();
    expect(first.resources).toHaveLength(100);
    expect(first.nextCursor).toBeDefined();

    const second = await client.listResources({ cursor: first.nextCursor });
    expect(second.resources).toHaveLength(100);
    expect(second.nextCursor).toBeDefined();

    const third = await client.listResources({ cursor: second.nextCursor });
    expect(third.resources).toHaveLength(50);
    expect(third.nextCursor).toBeUndefined();

    // Pages are disjoint and cover the whole set.
    const uris = new Set([...first.resources, ...second.resources, ...third.resources].map((r) => r.uri));
    expect(uris.size).toBe(250);
  });

  it('rejects a malformed cursor with InvalidParams (-32602)', async () => {
    const client = await connect(() => many);
    // "Zm9v" is base64url for "foo" — decodes to a non-numeric offset.
    await expect(client.listResources({ cursor: 'Zm9v' })).rejects.toMatchObject({ code: -32602 });
  });
});

describe('skill-server prompts', () => {
  const REFACTOR_PROMPT = [
    '---',
    'description: Refactor a scope',
    'arguments:',
    '  - name: scope',
    '    description: What to refactor',
    '  - name: depth',
    '    required: true',
    '---',
    'Refactor: {{scope}}',
    '',
    'Depth: {{ depth }}. Keep {{untouched}} as written.',
    '',
  ].join('\n');

  /** Prompt file contents by `<skill>/<path>`, standing in for the skills directory. */
  const FILES: Record<string, string> = {
    'standards/prompts/refactor.md': REFACTOR_PROMPT,
    'standards/prompts/plain.md': 'Just do the thing.\n',
    'tickets/prompts/refactor.md': '---\ndescription: Refactor from a ticket\n---\nTicket refactor.',
  };

  const dirSkill = (name: string, paths: string[]): Skill =>
    skill({
      name,
      format: 'dir',
      path: `${name}/SKILL.md`,
      files: paths.map((filePath) => ({ path: filePath, type: 'file' as const, size: 1 })),
    });

  // Listed out of name order, so the collision rule is shown to sort rather than follow input order.
  const PROMPT_SKILLS: Skill[] = [
    dirSkill('tickets', ['prompts/refactor.md']),
    dirSkill('standards', [
      'prompts/refactor.md',
      'prompts/plain.md',
      'prompts/nested/deep.md',
      'prompts/notes.txt',
      'prompts/bad name.md',
      'reference.md',
    ]),
  ];

  const reader = {
    readSupportingFile: async (skillName: string, relPath: string) => {
      const content = FILES[`${skillName}/${relPath}`];
      if (content === undefined) {
        throw new Error('no such file');
      }
      return { path: relPath, content, encoding: 'utf8' as const, size: content.length, binary: false };
    },
  };

  /** The text of a prompt result's only message. */
  function promptText(res: { messages: Array<{ role: string; content: unknown }> }): string {
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]?.role).toBe('user');
    return (res.messages[0]?.content as { text: string }).text;
  }

  it('does not advertise prompts when the endpoint cannot read skill files', async () => {
    const client = await connect(() => PROMPT_SKILLS);
    expect(client.getServerCapabilities()?.prompts).toBeUndefined();
  });

  it('advertises prompts without listChanged on a stateless endpoint', async () => {
    const client = await connect(() => PROMPT_SKILLS, reader);
    expect(client.getServerCapabilities()?.prompts).toEqual({});
  });

  it('returns an empty list when no served skill has a prompt', async () => {
    const client = await connect(() => SKILLS, reader);
    expect(await client.listPrompts()).toEqual({ prompts: [] });
  });

  it('lists each prompts/<name>.md with its declared description and arguments', async () => {
    const client = await connect(() => PROMPT_SKILLS, reader);
    const { prompts } = await client.listPrompts();
    expect(prompts).toEqual([
      {
        name: 'refactor',
        description: 'Refactor a scope',
        arguments: [
          { name: 'scope', description: 'What to refactor', required: false },
          { name: 'depth', required: true },
        ],
      },
      { name: 'plain', description: 'Prompt from the "standards" skill.', arguments: [] },
      { name: 'tickets__refactor', description: 'Refactor from a ticket', arguments: [] },
    ]);
  });

  it('gives the bare name to the first skill by sorted name and qualifies the later one', async () => {
    const client = await connect(() => PROMPT_SKILLS, reader);
    expect(promptText(await client.getPrompt({ name: 'refactor', arguments: { depth: '1' } }))).toContain('Depth: 1.');
    expect(promptText(await client.getPrompt({ name: 'tickets__refactor' }))).toBe('Ticket refactor.');
  });

  it('substitutes declared arguments and leaves other placeholders as written', async () => {
    const client = await connect(() => PROMPT_SKILLS, reader);
    const res = await client.getPrompt({ name: 'refactor', arguments: { scope: 'src/{{depth}}', depth: 'deep' } });
    expect(res.description).toBe('Refactor a scope');
    // A value is inserted as given: a placeholder inside it is not filled in a second pass.
    expect(promptText(res)).toBe('Refactor: src/{{depth}}\n\nDepth: deep. Keep {{untouched}} as written.');
  });

  it('fills an optional argument that was left out with an empty string', async () => {
    const client = await connect(() => PROMPT_SKILLS, reader);
    const text = promptText(await client.getPrompt({ name: 'refactor', arguments: { depth: 'deep' } }));
    expect(text).toBe('Refactor: \n\nDepth: deep. Keep {{untouched}} as written.');
  });

  it('rejects a get that leaves out a required argument', async () => {
    const client = await connect(() => PROMPT_SKILLS, reader);
    await expect(client.getPrompt({ name: 'refactor', arguments: { scope: 'src' } })).rejects.toThrow(
      /missing required argument: depth/,
    );
  });

  it('rejects an unknown prompt', async () => {
    const client = await connect(() => PROMPT_SKILLS, reader);
    await expect(client.getPrompt({ name: 'nope' })).rejects.toThrow(/Unknown prompt "nope"/);
  });

  it('serves only the prompts of the skills this endpoint serves', async () => {
    const client = await connect(() => PROMPT_SKILLS.filter((s) => s.name === 'tickets'), reader);
    const { prompts } = await client.listPrompts();
    // With "standards" out of scope nothing collides, so the name is bare here.
    expect(prompts.map((p) => p.name)).toEqual(['refactor']);
    expect(promptText(await client.getPrompt({ name: 'refactor' }))).toBe('Ticket refactor.');
    await expect(client.getPrompt({ name: 'plain' })).rejects.toThrow(/Unknown prompt/);
  });

  it('leaves prompt files out of the loaded skill footer but keeps them readable', async () => {
    const client = await connect(() => PROMPT_SKILLS, reader);
    const text = firstText(await client.callTool({ name: 'standards' }));
    expect(text).toContain('- reference.md');
    expect(text).toContain('- prompts/notes.txt');
    expect(text).not.toContain('prompts/refactor.md');
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('skill://standards/prompts/refactor.md');
  });

  it('announces a changed prompt list on a live endpoint', async () => {
    let fire = (): void => {};
    const client = await connect(() => PROMPT_SKILLS, {
      ...reader,
      onSkillsChanged: (listener) => {
        fire = listener;
        return () => {};
      },
    });
    expect(client.getServerCapabilities()?.prompts).toEqual({ listChanged: true });
    let listChanged = 0;
    client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
      listChanged += 1;
    });
    fire();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listChanged).toBe(1);
  });
});

describe('skill-server live updates (stdio)', () => {
  const wireReader = {
    readSupportingFile: async () => ({ path: '', content: '', encoding: 'utf8' as const, size: 0, binary: false }),
  };

  it('omits listChanged/subscribe when onSkillsChanged is not wired (stateless HTTP)', async () => {
    const client = await connect(() => SKILLS);
    expect(client.getServerCapabilities()?.resources).toEqual({});
  });

  it('advertises listChanged + subscribe and pushes notifications on change', async () => {
    let fire = (): void => {};
    const client = await connect(() => SKILLS, {
      ...wireReader,
      onSkillsChanged: (listener) => {
        fire = listener;
        return () => {};
      },
    });
    expect(client.getServerCapabilities()?.resources).toMatchObject({ listChanged: true, subscribe: true });

    let listChanged = 0;
    const updated: string[] = [];
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      listChanged += 1;
    });
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (n) => {
      updated.push(n.params.uri);
    });

    await client.subscribeResource({ uri: 'skill://commit.messages' });
    fire();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(listChanged).toBe(1);
    expect(updated).toEqual(['skill://commit.messages']);
  });

  it('stops pushing resources/updated after unsubscribe (but still lists changed)', async () => {
    let fire = (): void => {};
    const client = await connect(() => SKILLS, {
      ...wireReader,
      onSkillsChanged: (listener) => {
        fire = listener;
        return () => {};
      },
    });
    let listChanged = 0;
    const updated: string[] = [];
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      listChanged += 1;
    });
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (n) => {
      updated.push(n.params.uri);
    });

    await client.subscribeResource({ uri: 'skill://commit.messages' });
    await client.unsubscribeResource({ uri: 'skill://commit.messages' });
    fire();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(listChanged).toBe(1);
    expect(updated).toEqual([]);
  });
});

describe('skill-server advertised tools with authoring on', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mcp-skills-tools-'));
    store = new ConfigStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('pins every tool definition in per-skill mode', async () => {
    const client = await connect(() => SKILLS, { authoring: { store } });
    expect((await client.listTools()).tools).toMatchSnapshot();
  });

  it('pins every tool definition in loader mode', async () => {
    const client = await connect(() => SKILLS, { authoring: { store }, getSkillToolMode: () => 'loader' });
    expect((await client.listTools()).tools).toMatchSnapshot();
  });

  it('pins the authoring tools of a workspace endpoint', async () => {
    const client = await connect(() => SKILLS, { authoring: { store, workspaceSlug: 'examples' } });
    expect((await client.listTools()).tools).toMatchSnapshot();
  });
});
