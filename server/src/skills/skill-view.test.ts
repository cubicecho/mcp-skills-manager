import { describe, expect, it } from 'vitest';
import { skillToolNames } from './skill-view.ts';

/**
 * Names the tools a set of skill names is served under.
 * @param names - Skill names, in any order.
 * @returns Each skill name with its tool name, in sorted skill order.
 */
function toolNames(names: string[]): Array<[string, string]> {
  return [...skillToolNames(names.map((name) => ({ name })))];
}

describe('skillToolNames', () => {
  it('serves a skill under its own name, with dots turned into underscores', () => {
    expect(toolNames(['pdf-forms', 'commit.messages'])).toEqual([
      ['commit.messages', 'commit_messages'],
      ['pdf-forms', 'pdf-forms'],
    ]);
  });

  it('keeps the bare name for the skill that is really called it and qualifies the other', () => {
    expect(toolNames(['a.b', 'a_b'])).toEqual([
      ['a.b', 'a_b__2'],
      ['a_b', 'a_b'],
    ]);
  });

  it('numbers later skills in sorted order when none is really called the shared name', () => {
    expect(toolNames(['a_b.c', 'a.b.c', 'a.b_c'])).toEqual([
      ['a.b.c', 'a_b_c'],
      ['a.b_c', 'a_b_c__2'],
      ['a_b.c', 'a_b_c__3'],
    ]);
  });

  it('skips a qualified name another skill is really called', () => {
    expect(toolNames(['a.b', 'a_b', 'a_b__2'])).toEqual([
      ['a.b', 'a_b__3'],
      ['a_b', 'a_b'],
      ['a_b__2', 'a_b__2'],
    ]);
  });
});
