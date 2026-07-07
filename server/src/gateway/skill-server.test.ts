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

/** Wire a Client to a fresh skill server over a linked in-memory transport pair. */
async function connect(getSkills: () => Skill[]): Promise<Client> {
  const server = createSkillServer({ getSkills, label: 'test' });
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
