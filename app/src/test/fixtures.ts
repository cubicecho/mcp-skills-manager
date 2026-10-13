import type { SkillDetail } from '@mcp-skills/shared';

/**
 * A complete skill for a test, with only the fields that matter spelled out.
 * @param overrides - Fields that differ from the default dir skill.
 * @returns The skill.
 */
export function aSkill(overrides: Partial<SkillDetail> = {}): SkillDetail {
  const name = overrides.name ?? 'commit-messages';
  return {
    name,
    description: '',
    body: '',
    frontmatter: {},
    format: 'dir',
    global: true,
    readOnly: false,
    path: `${name}/SKILL.md`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: [],
    tags: [],
    usage: { count: 0, lastUsedAt: null },
    ...overrides,
  };
}

/** A git source for a linked skill, as the server reports it after a sync. */
export const A_SOURCE: NonNullable<SkillDetail['source']> = {
  repo: 'https://github.com/o/r',
  commit: 'abc1234',
  syncedAt: '2026-01-01T00:00:00.000Z',
};
