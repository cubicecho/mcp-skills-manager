import { type SkillSummary, skillSummarySchema } from '@mcp-skills/shared';
import { describe, expect, it } from 'vitest';
import { collectTags, filterAndSort } from './skill-list';

/** A listed skill, with only what a test cares about spelled out. */
function aSkill(name: string, overrides: Partial<SkillSummary> = {}): SkillSummary {
  return skillSummarySchema.parse({
    name,
    description: '',
    format: 'dir',
    path: `${name}/SKILL.md`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: [],
    ...overrides,
  });
}

const names = (skills: SkillSummary[]) => skills.map((skill) => skill.name);

const SKILLS = [
  aSkill('commits', { description: 'Write Commit messages', tags: ['git'], usage: { count: 3, lastUsedAt: null } }),
  aSkill('alpha', { format: 'file', updatedAt: '2026-03-01T00:00:00.000Z', usage: { count: 3, lastUsedAt: null } }),
  aSkill('review', { global: false, tags: ['git', 'style'], updatedAt: '2026-02-01T00:00:00.000Z' }),
];

describe('filterAndSort', () => {
  it('lists every skill by name when nothing is filtered', () => {
    expect(
      names(filterAndSort(SKILLS, { query: '', scope: 'all', format: 'all', tag: undefined, sort: 'name' })),
    ).toEqual(['alpha', 'commits', 'review']);
  });

  it('leaves the list it was given in its own order', () => {
    filterAndSort(SKILLS, { query: '', scope: 'all', format: 'all', tag: undefined, sort: 'name' });
    expect(names(SKILLS)).toEqual(['commits', 'alpha', 'review']);
  });

  it('keeps global or workspace-scoped skills by scope', () => {
    expect(
      names(filterAndSort(SKILLS, { query: '', scope: 'global', format: 'all', tag: undefined, sort: 'name' })),
    ).toEqual(['alpha', 'commits']);
    expect(
      names(filterAndSort(SKILLS, { query: '', scope: 'scoped', format: 'all', tag: undefined, sort: 'name' })),
    ).toEqual(['review']);
  });

  it('keeps one format', () => {
    expect(
      names(filterAndSort(SKILLS, { query: '', scope: 'all', format: 'file', tag: undefined, sort: 'name' })),
    ).toEqual(['alpha']);
    expect(
      names(filterAndSort(SKILLS, { query: '', scope: 'all', format: 'dir', tag: undefined, sort: 'name' })),
    ).toEqual(['commits', 'review']);
  });

  it('keeps the skills carrying a tag', () => {
    expect(
      names(filterAndSort(SKILLS, { query: '', scope: 'all', format: 'all', tag: 'style', sort: 'name' })),
    ).toEqual(['review']);
    expect(
      names(filterAndSort(SKILLS, { query: '', scope: 'all', format: 'all', tag: 'missing', sort: 'name' })),
    ).toEqual([]);
  });

  it('searches the name, description and tags, ignoring case and outer spaces', () => {
    expect(
      names(filterAndSort(SKILLS, { query: '  COMMIT ', scope: 'all', format: 'all', tag: undefined, sort: 'name' })),
    ).toEqual(['commits']);
    expect(
      names(filterAndSort(SKILLS, { query: 'messages', scope: 'all', format: 'all', tag: undefined, sort: 'name' })),
    ).toEqual(['commits']);
    expect(
      names(filterAndSort(SKILLS, { query: 'style', scope: 'all', format: 'all', tag: undefined, sort: 'name' })),
    ).toEqual(['review']);
  });

  it('applies every filter at once', () => {
    expect(
      names(filterAndSort(SKILLS, { query: 'git', scope: 'global', format: 'dir', tag: 'git', sort: 'name' })),
    ).toEqual(['commits']);
  });

  it('sorts the most recently updated first', () => {
    expect(
      names(filterAndSort(SKILLS, { query: '', scope: 'all', format: 'all', tag: undefined, sort: 'updated' })),
    ).toEqual(['alpha', 'review', 'commits']);
  });

  it('sorts the most used first, and equally used skills by name', () => {
    expect(
      names(filterAndSort(SKILLS, { query: '', scope: 'all', format: 'all', tag: undefined, sort: 'used' })),
    ).toEqual(['alpha', 'commits', 'review']);
  });
});

describe('collectTags', () => {
  it('lists each tag once, in alphabetical order', () => {
    expect(collectTags(SKILLS)).toEqual(['git', 'style']);
  });

  it('is empty when no skill has a tag', () => {
    expect(collectTags([aSkill('plain')])).toEqual([]);
  });
});
