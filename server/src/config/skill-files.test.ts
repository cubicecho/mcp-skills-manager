import { describe, expect, it } from 'vitest';
import { safeRelPath } from './skill-files.ts';

describe('safeRelPath', () => {
  it('keeps a name that only begins with dots', () => {
    expect(safeRelPath('..notes.md')).toBe('..notes.md');
    expect(safeRelPath('docs/...')).toBe('docs/...');
  });

  it('reads a leading slash as the skill root', () => {
    expect(safeRelPath('/docs/a.md')).toBe('docs/a.md');
  });

  it('refuses an empty path and one that leaves the skill', () => {
    for (const unsafe of ['', '.', '..', '../x', 'docs/../../x']) {
      expect(() => safeRelPath(unsafe)).toThrow(`Unsafe file path "${unsafe}"`);
    }
  });
});
