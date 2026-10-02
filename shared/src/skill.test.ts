import { describe, expect, it } from 'vitest';
import { skillSchema } from './skill.ts';

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
