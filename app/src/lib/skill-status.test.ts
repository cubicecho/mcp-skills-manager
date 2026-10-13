import { describe, expect, it } from 'vitest';
import { A_SOURCE, aSkill } from '@/test/fixtures';
import { skillStatuses } from './skill-status';

describe('skillStatuses', () => {
  it('says nothing about a global skill agents can edit', () => {
    expect(skillStatuses(aSkill({ global: true, readOnly: false }))).toEqual([]);
  });

  it('lists every fact that holds, most restrictive first', () => {
    expect(skillStatuses(aSkill({ global: false, readOnly: true, source: A_SOURCE }))).toEqual([
      'linked',
      'readOnly',
      'scoped',
    ]);
  });

  it('marks a skill the root endpoint does not serve', () => {
    expect(skillStatuses(aSkill({ global: false }))).toEqual(['scoped']);
  });
});
