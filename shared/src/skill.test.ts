import { describe, expect, it } from 'vitest';
import { slugify } from './profile.ts';
import { skillNameSchema, skillSchema, slugifySkillName } from './skill.ts';

describe('slugifySkillName', () => {
  it('lowercases and dashes free-form titles', () => {
    expect(slugifySkillName('Commit Messages')).toBe('commit-messages');
  });

  it('strips a leading non-alphanumeric run', () => {
    expect(slugifySkillName('  ...My Skill')).toBe('my-skill');
  });

  it('drops trailing dashes and dots', () => {
    expect(slugifySkillName('Skill!!!')).toBe('skill');
    expect(slugifySkillName('a.b.')).toBe('a.b');
  });

  it('collapses runs of separators into a single dash', () => {
    expect(slugifySkillName('a   &   b')).toBe('a-b');
  });

  it('caps length at 64 characters', () => {
    expect(slugifySkillName('x'.repeat(100))).toHaveLength(64);
  });

  it('produces values that satisfy skillNameSchema', () => {
    for (const title of ['Commit Messages', 'PDF Forms!', 'my_skill.v2']) {
      expect(skillNameSchema.safeParse(slugifySkillName(title)).success).toBe(true);
    }
  });
});

describe('slugify (profiles) matches slugifySkillName behaviour', () => {
  it('produces the same slug for the same input', () => {
    expect(slugify('Back End Team')).toBe(slugifySkillName('Back End Team'));
  });
});

describe('skillNameSchema', () => {
  it('accepts lowercase slugs with dots, dashes, underscores', () => {
    for (const name of ['a', 'skill', 'my-skill', 'my_skill', 'v1.2', 'a0']) {
      expect(skillNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it('rejects uppercase, leading punctuation, spaces, and overlong names', () => {
    for (const name of ['Skill', '-skill', '.skill', 'my skill', '', 'x'.repeat(65)]) {
      expect(skillNameSchema.safeParse(name).success).toBe(false);
    }
  });
});

describe('skillSchema', () => {
  it('applies defaults for description, frontmatter, and files', () => {
    const parsed = skillSchema.parse({
      name: 'demo',
      body: '# Demo',
      format: 'file',
      path: 'demo.md',
      updatedAt: '2026-07-06T00:00:00.000Z',
    });
    expect(parsed.description).toBe('');
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.files).toEqual([]);
  });
});
