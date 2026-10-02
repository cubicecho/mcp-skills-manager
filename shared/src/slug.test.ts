import { describe, expect, it } from 'vitest';
import { slugify, slugSchema } from './slug.ts';

describe('slugify', () => {
  it('lowercases and dashes free-form titles', () => {
    expect(slugify('Commit Messages')).toBe('commit-messages');
  });

  it('strips a leading non-alphanumeric run', () => {
    expect(slugify('  ...My Skill')).toBe('my-skill');
  });

  it('drops trailing dashes and dots', () => {
    expect(slugify('Skill!!!')).toBe('skill');
    expect(slugify('a.b.')).toBe('a.b');
  });

  it('collapses runs of separators into a single dash', () => {
    expect(slugify('a   &   b')).toBe('a-b');
  });

  it('caps length at 64 characters', () => {
    expect(slugify('x'.repeat(100))).toHaveLength(64);
  });

  it('produces values that satisfy slugSchema', () => {
    for (const title of ['Commit Messages', 'PDF Forms!', 'my_skill.v2']) {
      expect(slugSchema.safeParse(slugify(title)).success).toBe(true);
    }
  });
});

describe('slugify for workspace names', () => {
  it('produces the same slug a skill title would', () => {
    expect(slugify('Back End Team')).toBe('back-end-team');
  });
});

describe('slugSchema', () => {
  it('accepts lowercase slugs with dots, dashes, underscores', () => {
    for (const name of ['a', 'skill', 'my-skill', 'my_skill', 'v1.2', 'a0']) {
      expect(slugSchema.safeParse(name).success).toBe(true);
    }
  });

  it('rejects uppercase, leading punctuation, spaces, and overlong names', () => {
    for (const name of ['Skill', '-skill', '.skill', 'my skill', '', 'x'.repeat(65)]) {
      expect(slugSchema.safeParse(name).success).toBe(false);
    }
  });
});
