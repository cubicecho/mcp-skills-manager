import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeMarkdown } from './markdown.ts';

describe('parseMarkdown', () => {
  it('splits frontmatter from body', () => {
    const raw = '---\nname: demo\ndescription: A demo skill\n---\n\n# Demo\n\nHello.\n';
    const { frontmatter, body } = parseMarkdown(raw);
    expect(frontmatter.name).toBe('demo');
    expect(frontmatter.description).toBe('A demo skill');
    // The closing `---\n` is consumed; the blank line separating it from the body remains
    // (serializeMarkdown normalizes leading whitespace on the way back out).
    expect(body).toBe('\n# Demo\n\nHello.\n');
  });

  it('treats a document without frontmatter as all body', () => {
    const raw = '# Just a body\n';
    expect(parseMarkdown(raw)).toEqual({ frontmatter: {}, body: raw });
  });

  it('preserves unknown frontmatter keys (passthrough)', () => {
    const { frontmatter } = parseMarkdown('---\nname: demo\nauthor: ada\n---\nbody\n');
    expect(frontmatter.author).toBe('ada');
  });

  it('falls back to treating the whole document as body on malformed YAML', () => {
    const raw = '---\nname: : :\n bad\n---\nbody\n';
    const { frontmatter, body } = parseMarkdown(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it('handles CRLF line endings', () => {
    const { frontmatter, body } = parseMarkdown('---\r\nname: demo\r\n---\r\n# Body\r\n');
    expect(frontmatter.name).toBe('demo');
    expect(body).toBe('# Body\r\n');
  });
});

describe('serializeMarkdown', () => {
  it('writes a frontmatter block followed by the normalized body', () => {
    const out = serializeMarkdown({ name: 'demo', description: 'A demo' }, '# Demo\n');
    expect(out).toBe('---\nname: demo\ndescription: A demo\n---\n\n# Demo\n');
  });

  it('omits the frontmatter block when empty', () => {
    expect(serializeMarkdown({}, '# Body')).toBe('# Body\n');
    expect(serializeMarkdown({}, '   ')).toBe('');
  });

  it('round-trips a document losslessly', () => {
    const raw = '---\nname: demo\ndescription: A demo skill\nauthor: ada\n---\n\n# Demo\n\nBody text.\n';
    const { frontmatter, body } = parseMarkdown(raw);
    expect(serializeMarkdown(frontmatter, body)).toBe(raw);
  });
});
